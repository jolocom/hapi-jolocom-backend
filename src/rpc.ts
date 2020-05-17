import { Plugin, Server, Request, ResponseToolkit } from '@hapi/hapi';
import { JolocomSDK } from '@jolocom/sdk'
import { JolocomLib } from 'jolocom-lib'
//@ts-ignore WebSocket is not exported
import {Server as WSServer, WebSocket} from 'ws'
import * as url from 'url'

type PluginOptions = {
  sdk: JolocomSDK;
  path: string;
};

type ChannelState = {
    token?: string
    frontend?: WebSocket
    wallet?: WebSocket
    established?: boolean
}

class PeerMap {
  private peerMap: {
    [identifier: string]: ChannelState
  } = {}

  public getChannel = (id: string) => this.peerMap[id] || {}

  public isChannelInitialised = (id: string) => this.peerMap[id].established

  // If the token is not set, the rendevouz endpoint never redirected to it.
  public doesChannelExist = (id: string) => !!this.peerMap[id].token

  public updateChannel = (id: string, channels: ChannelState) => {
    this.peerMap[id] = {
      ...this.getChannel(id),
      ...channels
    }
  }
}

const peerMap = new PeerMap()

const authRequestToken = async (sdk: JolocomSDK, callbackURL: string) => {
  return sdk.idw.create.interactionTokens.request.auth({
    callbackURL
  }, await sdk.bemw.keyChainLib.getPassword())
}

export const rpcProxyPlugin: Plugin<PluginOptions> = {
  name: "rpcProxy",
  version: "0.0.1",
  requirements: {
    node: "10",
  },
  register: async (server: Server, { sdk }: PluginOptions) => {
    const randevouzPath = '/rpcProxy';
    const secludedPath = '/secluded/';

    // This is only used to redirect to a secluded path.
    // The redirection happens in the handshake, in the server.on('upgrade') event handler.
    const randevouz = new WSServer({ 
      noServer: true,
    }).on('connection', ws => ws.close());

    const secluded = new WSServer({
      noServer: true,
    }).on('connection', (ws, req) => {
      const parts = url.parse(req.url).path.split('/')
      const nonce = parts[parts.length - 1]

      if (!peerMap.doesChannelExist(nonce)) {
        throw new Error('Not initialized.') // TODO Error handling
      }
      
      // Every client is greeted with an authentication request
      // As long as the request is valid, the channel can be joined by holders
      ws.send(peerMap.getChannel(nonce).token)

      ws.on('message', async data => {
        // At this point we might receive a generic encryption event, or an authentication response, everything else is considered invalid input
        // First check if the channel is already established
        if (peerMap.isChannelInitialised(nonce)) {
          debug(data)
          // proxy
          // or handle encryption / decryption
        } else {
          // Now we check perhaps the message is an authentication response.
          // In this case we attempt to validate it against the request, and mark
          // the channel as established.
          try {
            // As far as I can tell, there's no way to instantiate a JsonWebToken<JWTEncodable> through the sdk
            // had to resort to this. // TODO, lift
            const response = JolocomLib.parse.interactionToken.fromJWT(data.toString())
            const request = JolocomLib.parse.interactionToken.fromJWT(peerMap.getChannel(nonce).token)

            await sdk.idw.validateJWT(
              response,
              request
            )

            peerMap.updateChannel(nonce, {
              wallet: ws,
              established: true
            })
            debug(`New peer connected to secluded channel ${nonce}, both peers on. Channel established.`)
          } catch (err) {
              // TODO Handle
              debug(err)
          }
        }
      })
    })

    // https://github.com/websockets/ws#multiple-servers-sharing-a-single-https-server
    server.listener.on('upgrade', async (request, socket, head) => {
      const pathname = url.parse(request.url).pathname
      debug(`New WS handshake on ${pathname}`)

      // The Frontend can connect to this endpoint to be automatically redirected to a secluded channel
      // at a random nonce.
      if (pathname === randevouzPath) {
          const token = await authRequestToken(sdk, request.url.href)
          peerMap.updateChannel(token.nonce, {token: token.encode()})

          // TODO Env variable for port and host
          return socket.end(`HTTP/1.1 302 Found\nLocation: ws://192.168.137.1:9000${secludedPath}${token.nonce}\n\n`)
      } else if (pathname.includes(secludedPath)) {
          // We need to ensure the peer is trying to access a valid* secluded endpoint
          // Valid means the randevouz endpoint redirected to it earlier. I.e. the peer
          // is not allowed to randomly select a nonce
          const parts = pathname.split('/')
          const nonce = parts[parts.length - 1]

          if (!peerMap.doesChannelExist(nonce)) {
            throw new Error('Unknown channel, invalid nonce') // TODO Error handling
          }

          return secluded.handleUpgrade(request, socket, head, ws => {
            // If all is good, the peer is added to the existing channel state
            peerMap.updateChannel(nonce, {
              frontend: ws
            })

            secluded.emit('connection', ws, request) 
          })
      }
    })
  }
}
export const debug = (input: any) => process.env.DEBUG && console.log(input)