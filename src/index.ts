import * as hapi from 'hapi'
import { FilePasswordStore, JolocomSDK } from "@jolocom/sdk"
import { JolocomTypeormStorage } from "@jolocom/sdk-storage-typeorm"
import { rpcProxyPlugin } from './rpc'
const typeorm = require("typeorm")

const typeormConfig = {
  type: 'sqlite',
  database: __dirname + '/db.sqlite3',
  logging: ['error', 'warn', 'schema'],
  entities: [ ...require('@jolocom/sdk-storage-typeorm').entityList ],
  migrations: [__dirname + '/migrations/*.ts'],
  migrationsRun: true,
  synchronize: true,
  cli: {
    migrationsDir: __dirname + '/migrations',
  }
}

export const init = async () => {
  const passwordStore = new FilePasswordStore(__dirname+'/password.txt')
  const connection = await typeorm.createConnection(typeormConfig)
  const storage = new JolocomTypeormStorage(connection)

  const sdk = new JolocomSDK({
    storage,
    passwordStore
  })

  const port = process.env.PUBLIC_PORT || 9000;
  await sdk.init()

  const server = new hapi.Server({
    host: "localhost",
    port,
    debug: {
      request: "*"
    }
  });

  await server.register({
    plugin: rpcProxyPlugin,
    options: {
      sdk,
      path: 'wallet/abcd', // TODO random
      server
    }
  });

  await server.start();
  console.log("running")
};

init();

//  plugin: sdkPlugin,
//  options: { identityData: {
//    storage, passwordStore
//  },
//  verifierOptions: [{
//    name: "TEST",
//    requirements: [
//      {
//        type: ["email"],
//        constraints: []
//      }
//    ],
//  }
//],
//  }
