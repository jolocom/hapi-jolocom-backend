import { Plugin, Server, Request, ResponseToolkit } from '@hapi/hapi'
import { JolocomSDK } from '@jolocom/sdk'
import { JolocomLib } from 'jolocom-lib'
//@ts-ignore WebSocket is not exported
import {Server as WSServer, WebSocket} from 'ws'
import * as url from 'url'

const debug = process.env.DEBUG
  ? console.log.bind(console)
  : function(){}

debug('Debugging output is on')

const PUBLIC_HOSTPORT = 'localhost:9000'
const PUBLIC_HTTP_URL = `http://${PUBLIC_HOSTPORT}`
const PUBLIC_WS_URL = `ws://${PUBLIC_HOSTPORT}`

type PluginOptions = {
  sdk: JolocomSDK;
  path: string;
};


// FIXME this is not a channel, it's a session
type ChannelState = {
    // TODO rename to authRequest?
    // FIXME set proper type instead of relying on ReturnType
    token: ReturnType<sdk.idw.create.interactionTokens.request.auth>
    rpcWS?: WebSocket
    ssiWS?: WebSocket
    established?: boolean
    messages: {[id: string]: any}
}

class PeerMap {
  private peerMap: {
    [identifier: string]: ChannelState
  } = {}

  public getChannel = (id: string): ChannelState => {
    const ch = this.peerMap[id]
    if (!ch) throw new Error('channel not found!')
    return ch
  }
  public getChannelJSON = (ch: ChannelState, relayPath: string): ChannelState => {
    return {
      jwt: ch.token.encode(),
      nonce: ch.token.nonce,
      rpcWS: `ws://${callbackPrefix}${relayPath}`
    }
  }

  public isChannelInitialised = (id: string) => this.getChannel(id).established

  // If the token is not set, the rendevouz endpoint never redirected to it.
  public doesChannelExist = (id: string) => !!this.getChannel(id).token

  // This is partial because of the messages field
  public updateChannel = (id: string, update: Partial<ChannelState>) => {
    const ch = this.getChannel(id)
    newCh = this.peerMap[id] = {
      ...ch,
      ...update
    }
    return newCh
  }

  // FIXME rename to createChannelRelay? or something
  public createChannel = (sdk: JolocomSDK) => {
    const callbackPath = '/rpcProxy/ssi' // FIXME compute
    const token = await authRequestToken(sdk, `${PUBLIC_WS_URL}${callbackPath}`)
    // FIXME add QR code also!
    const ch = {
      token: token,
      id: token.nonce,
      // FIXME add info about connected peers in a more structure manner than
      // just `rpcWS` and `ssiWS`?
    }
    this.peerMap[ch.id] = ch
    return ch
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
    /**
     * Route handler for SSI capable agents.
     *
     * Agents are expected to exclusively use WS
     *
     * On initial connection, Agents are expected to send an Authentication
     * reponse JWT to establish the channel.
     */
    server.route({
      method: 'POST', path: '/ssi',
      config: {
        // payloads are expedted to be JWT, and maybe FIXME auto parse
        payload: { output: 'data', parse: true, allow: 'text/plain' },
        plugins: {
          websocket: {
            only: true,
            connect: ({ ctx, ws }) => {
              // TODO track the ws early on, to keep the peerMap up-to-date
              // TODO reset any timeouts that were set to clear the open channel from memory
            },
            disconnect: ({ ctx }) => {
              // TODO set a timeout to clear the open channel from memory
            }
          }
        }
      },
      handler: async (
        request: Request,
        h: ResponseToolkit
      ) => {
        debug("incoming message from SSI agent")

        let { initially, ws, ctx } = request.websocket()

        const data = request.payload
        if (!data) {
          debug('no payload')
          return
        }

        let ch = ctx.ch
        if (!ch) {
          // If the connection context doesn't already have an associated
          // channel then this client has not yet successfully authenticated
          //
          // We expect to receive an Authentication Response
          const authResp = JolocomLib.parse.interactionToken.fromJWT(data)
          ch = peerMap.getChannel(authResp.nonce)
          const authReq = ch.token

          // FIXME TODO does this throw if invalid?
          // FIXME Boom error handling
          await sdk.idw.validateJWT(authResp, authReq)

          const newCh = ctx.ch = peerMap.updateChannel(ch.token.nonce, {
            ssiWS: ws,
            established: true
          })
          debug(`New SSI Agent connected to channel ${newCh.token.nonce}. Channel established.`)
          // FIXME this should just pass the token through the interaction
          // manager maybe? then return whatever is returned
          return
        }

        // FIXME TODO
        //sdk.tokenReceived
        // find msg by id somehow
        // maybe msg id should be nonce of created RPC request?
        // proxy resp from wallet to browser/client
        ch.rpcWS.send(data.toString())
      },
    })


    /**
     * Route handler for non-SSI capable frontends
     *
     * Frontend clients must POST to '/' to create a new channel/session
     * They will then get a channel JSON object which contains a ws:// URL to
     * connect to this newly created channel
     *
     * The ws:// URL generated is by appending the token nonce
     */
    server.route({
      method: "POST", path: `/{nonce?}`,
      config: {
        payload: { output: "data", parse: true, allow: "application/json" },
        plugins: {
          websocket: {
            connect: ({ ctx, ws }) => {
              // TODO track the ws early on, to keep the peerMap up-to-date
              // TODO reset any timeouts that were set to clear the open channel from memory
            },
            disconnect: ({ ctx }) => {
              // TODO set a timeout to clear the open channel from memory
            }
          }
        },
      },
      handler: async (
        request: Request,
        h: ResponseToolkit
      ) => {
        let { initially, ws, ctx } = request.websocket()
        const params = request.params || {}
        let ch = ctx.ch

        if (!ch) {
          // if there's a nonce then we are talking to an 'authenticated' frontend
          if (params.nonce && mode == 'websocket' && ws) {
            try {
              ctx.ch = ch = peerMap.updateChannel(params.nonce, {
                rpcWS: ws
              })
            } catch (err) {
              return Boom.badRequest(err.toString())
            }
          } else {
            // If the connection context doesn't already have an associated
            // channel then we simply create a new one for this frontend client
            debug('awaiting createChannel')
            ctx.ch = await peerMap.createChannel(sdk)
            const chJSON = peerMap.getChannelJSON(ctx.ch)
            debug('channel json', chJSON)
            return chJSON
            // FIXME what about rpcStart
            //const rpcStart = {
            //  authToken: chan.token,
            //  authTokenQR: null, // TODO encode?
            //  identifier: nonce,
            //  ws: `${PUBLIC_WS_URL}${secludedPath}${nonce}`
            //}
          }
        }

        // All incoming messages on the frontend WebSocket are expected to be
        // RPC calls in a simple JSON format
        // These calls must be proxied to the connected SSI Agent, in the form
        // of JWT interaction tokens.
        const msg = request.payload // hapi auto parsed
        if (!msg) {
          debug('no msg :(')
          return
        }

        // TODO create rpc request
        let ssiRPC
        if (msg.rpc == 'asymEncrypt') {
          ssiRPC = await sdk.rpcEncRequest({
          toEncrypt: Buffer.from(msg.request),
            target: '#key-1',
            callbackURL: ''
          })
        } else if (msg.rpc == 'asymDecrypt') {
          ssiRPC = await sdk.rpcDecRequest({
            toDecrypt: Buffer.from(msg.request),
            callbackURL: ''
            })
        }

        ch.ssiWS.send(ssiRPC)

        return new Promise(resolve => {
            // we postpone this request's resolution until the SSI agent
            // responds
            msg.resolve = resolve
            ch.messages[msg.id] = msg
          })
        }
      },
    })

  }
}
export const debug = (input: any) => process.env.DEBUG && console.log(input)
