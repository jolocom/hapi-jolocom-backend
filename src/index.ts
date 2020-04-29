import * as hapi from "hapi";
import { sdkPlugin, SDKOptions } from "hapi-jolocom-plugin";
import config from "../config.json";

export const init = async () => {
  const server = new hapi.Server({
    host: "localhost",
    port: process.env.PUBLIC_PORT || 9000,
  });

  await server.register({
    plugin: sdkPlugin,
    options: (config as unknown) as SDKOptions,
  });

  await server.start();
};

init();
