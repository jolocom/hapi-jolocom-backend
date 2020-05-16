import { Plugin, Server, Request, ResponseToolkit } from "@hapi/hapi";
import { JolocomSDK } from '@jolocom/sdk'

type PluginOptions = {
  sdk: JolocomSDK;
  path: string;
  server: Server
};

const WebSocket = require('ws')
 
export const rpcProxyPlugin: Plugin<PluginOptions> = {
  name: "rpcProxy",
  version: "0.0.1",
  requirements: {
    node: "10",
  },
  register: async (server: Server, { sdk, server,  path: providedPath }: PluginOptions) => {
    const pingPath = '/frontend/ping';
    const pingWss = new WebSocket.Server({ server: server.listener, path: pingPath })

    // TODO For reconection, a AuthRequest can be replayed by the browser.
    // On a different endpoint probably
    //
    // For the browser
    server.route({
      method: 'POST',
      path: pingPath,
      handler: () => {
        // Note, state is not needed. I.e. we don't need to manage nonces.
        return 42 // TODO Randomize
      }
    })

    pingWss.on('connection', (ws) => {
      log('frontend application requesting nonce')
      ws.send(42); 
    });

    const path = `/${providedPath}`;

    const authRequest = "eYJ" // TODO Use registered issuance plugin methods here
    const wss = new WebSocket.Server({ server: server.listener, path });

    wss.on('connection', (ws) => {
      log('new peer, sending Authentication Request')
      ws.send(authRequest);

      ws.on('message', function incoming(data) {
        console.log(data);
      })
    });
  },
};

export const log = (input: any) => process.env.DEBUG || console.log(input)
