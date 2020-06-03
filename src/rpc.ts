import { Plugin, Server, Request, ResponseToolkit } from '@hapi/hapi'
import { JolocomSDK } from '@jolocom/sdk'
import { JolocomLib } from 'jolocom-lib'
//@ts-ignore WebSocket is not exported
import {Server as WSServer, WebSocket} from 'ws'
import * as url from 'url'

const PUBLIC_URL = "http://localhost:9000"

type PluginOptions = {
  sdk: JolocomSDK;
  path: string;
};


// FIXME this is not a channel, it's a session
type ChannelState = {
    token?: string
    frontend?: WebSocket
    wallet?: WebSocket
    established?: boolean
    messages: {[id: string]: any}
}

class PeerMap {
  private peerMap: {
    [identifier: string]: ChannelState
  } = {}

  public getChannel = (id: string): ChannelState => this.peerMap[id] // || { id, messages: {}}

  public isChannelInitialised = (id: string) => this.getChannel(id)?.established

  // If the token is not set, the rendevouz endpoint never redirected to it.
  public doesChannelExist = (id: string) => !!this.getChannel(id)?.token

  // This is partial because of the messages field
  public updateChannel = (id: string, channels: Partial<ChannelState>) => {
    const chan = this.getChannel(id)
    if (!chan) throw new Error('peer not connected!') // FIXME errors
    this.peerMap[id] = {
      ...chan,
      ...channels
    }
  }

  public createChannel = (sdk: JolocomSDK, callbackURLPrefix='') => {
    const token = await authRequestToken(sdk, `${callbackURLPrefix}/${tokenNonceLOL}`)
    const chan = { token: token.encode() }
    this.peerMap[token.nonce] = chan
    return chan
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
  register: async (server: Server, { sdk,  }: PluginOptions) => {
    const secludedPath = '/secluded/';

    // This is only used to redirect to a secluded path.
    // The redirection happens in the handshake, in the server.on('upgrade') event handler.

    server.route({
      // FIXME POST, but for testing purposes
      method: "POST", path: '/',
      handler: async (
        request: Request,
        h: ResponseToolkit
      ) => {
        return peerMap.createChannel(h.context.sdk, request.url.href)
      },
      options: {
        bind: { sdk },
      },
    });

    const secluded = new WSServer({
      noServer: true,
    }).on('connection', (ws, req) => {
      debug(`New WS handshake on ${pathname}`)
      const pathname = url.parse(request.url).pathname
      const parts = pathname.split('/')
      const isSSI = parts.length > 1 && parts[1] == 'frontend'
      const nonce = parts[0]
      const chan  = peerMap.getChannel(none)

      // The Frontend can connect to this endpoint to be automatically
      // redirected to a secluded channel identified by a random nonce.
      // We need to ensure the peer is trying to access a valid* secluded endpoint
      // Valid means the randevouz endpoint redirected to it earlier.
      // I.e. the peer is not allowed to randomly select a nonce
      if (!chan) {
        throw new Error('Unknown channel, invalid nonce') // TODO Error handling
      }

      if (isSSI) {
        // Every SSI Agent is greeted with an Authentication request
        // As long as the request is valid, the channel can be joined by holders
        ws.send(chan.token)

        ws.on('message', async data => {
          // At this point we might receive a
          //  generic encryption event, or an authentication response, everything else is considered invalid input

          // First check if the channel is already established
          if (chan.established) {
            debug("incoming message from SSI agent")
            debug(data)
            sdk.tokenReceived
            // FIXME TODO
            // proxy resp from wallet to browser/client
            ch.frontend.send(data.toString())
          } else {
            // Now we check perhaps the message is an authentication response.
            // In this case we attempt to validate it against the request, and mark
            // the channel as established.
            try {
              // As far as I can tell, there's no way to instantiate a JsonWebToken<JWTEncodable> through the sdk
              // had to resort to this. // TODO, lift
              const response = JolocomLib.parse.interactionToken.fromJWT(data.toString())
              const request = JolocomLib.parse.interactionToken.fromJWT(chan.token)

              await sdk.idw.validateJWT(
                response,
                request
              )

              // FIXME refactor??
              peerMap.updateChannel(nonce, {
                wallet: ws,
                established: true
              })
              debug(`New SSI Agent connected to secluded channel ${nonce}. Channel established.`)
            } catch (err) {
                // TODO Handle
                debug(err)
            }
          }
        })
      } else {
        // For non-SSI agents, we do no authentication besides that fact that
        // they know the secret nonce for this authentication operation
        peerMap.updateChannel(nonce, {
          frontend: ws,
        })

        // send token JWT to frontend
        const rpcStart = {
          authToken: chan.token,
          authTokenQR: null, // TODO encode?
          identifier: nonce,
          ws: `ws://${PUBLIC_URL}${secludedPath}${nonce}`
        }

        ws.send(JSON.stringify(rpcStart))

        // All incoming messages on the frontend WebSocket are expected to be
        // RPC calls in a simple JSON format
        // These calls must be proxied to the connected SSI Agent, in the form
        // of JWT interaction tokens.
        ws.on('message', async (data) => {
          const msg: any = JSON.parse(data)
          chan.messages[msg.id] = msg

          // TODO create rpc request
          let walletRPC
          if (msg.rpc == 'asymEncrypt') {
            walletRPC = await sdk.rpcEncRequest({
              toEncrypt: Buffer.from(msg.request),
              target: '#key-1',
              callbackURL: ''
            })
          } else if (msg.rpc == 'asymDecrypt') {
              walletRPC = await sdk.rpcDecRequest({
                toDecrypt: Buffer.from(msg.request),
                callbackURL: ''
              })
          }
          chan.wallet.send(walletRPC)
        })

        // TODO what was this for?
        secluded.emit('connection', ws, request)
      }

    })
  }
}
export const debug = (input: any) => process.env.DEBUG && console.log(input)
