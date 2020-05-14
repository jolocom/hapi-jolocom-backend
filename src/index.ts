import * as hapi from 'hapi'
import { sdkPlugin } from "hapi-jolocom-plugin"
import { FilePasswordStore } from "@jolocom/sdk"
import { JolocomTypeormStorage } from "@jolocom/sdk-storage-typeorm"
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

  const server = new hapi.Server({
    host: "localhost",
    port: process.env.PUBLIC_PORT || 9000,
    debug: {
      request: "*"
    }
  });

  await server.register({
    plugin: sdkPlugin,
    options: { identityData: {
      storage, passwordStore
    },
    verifierOptions: [{
      name: "TEST",
      requirements: [
        {
          type: ["email"],
          constraints: []
        }
      ],
    }
  ],
    }
  });

  await server.start();
  console.log("running")
};

init();
