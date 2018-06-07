import body from 'koa-body';
import compress from 'koa-compress';
import cors from 'koa-cors';
import fs from 'fs';
import helmet from 'koa-helmet';
import https from 'https';
import Koa from 'koa';
import mount from 'koa-mount';
import serve from 'koa-static';

import accessLogger from 'axon/middleware/accessLogger';
import errorMiddleware from 'axon/middleware/error';
import Logger from 'axon/utils/logger';
import router from 'axon/router';
import sigInitHandler from 'axon/utils/sigInitHandler';
import transactionMiddleware from 'axon/middleware/transaction';
import uncaughtExceptionHandler from 'axon/utils/uncaughtExceptionHandler';
import unhandledRejectionHandler from 'axon/utils/unhandledRejectionHandler';

// Catches ctrl+c event
process.on('SIGINT', sigInitHandler);

// Catches uncaught exceptions and rejections
process.on('uncaughtException', uncaughtExceptionHandler);
process.on('unhandledRejection', unhandledRejectionHandler);

/**
 * [app description]
 * @type {[type]}
 */
export default class Server {
  app: Function;
  config: Object;
  logger: Object;
  router: Object;

  /**
   * [constructor description]
   * @param  {[type]} void [description]
   * @return {[type]}      [description]
   */
  constructor(config: Object, appRouter: Object): void {
    // atexit handler
    process.on('exit', this.destroy);

    this.config = config;

    // Initialize the express server
    this.app = new Koa();

    // Create the logger
    this.logger = Logger.getLogger('app');

    // Configure the app with common middleware
    this.initialize(this.app);

    // Combine with application-specific router
    router.use(appRouter.routes());
    debugger;

    this.app.use(router.routes());
    this.app.use(router.allowedMethods());
  }

  /**
   * [createServer description]
   * @param  {[type]} void [description]
   * @return {[type]}      [description]
   */
  createServer(): Object {
    return (this.config.get('secure')) ? this.createHttpsServer() : this.app;
  }

  /**
   * [startHttps description]
   * @param  {[type]} void [description]
   * @return {[type]}      [description]
   */
  createHttpsServer(): void {
    this.app.all('*', function cb(request: Object, response: Object, next: Function) {
      if (request.secure) {
        return next();
      }

      return response.redirect(`https://${request.hostname}:${this.config.get('port')}${request.url}`);
    });

    const sslConfig = this.config.get('ssl');
    const httpsConfig = Object.assign({}, sslConfig, {
      key: fs.readFileSync(sslConfig.get('key')),
      cert: fs.readFileSync(sslConfig.get('cert')),
    });

    return https.createServer(httpsConfig, this.app.callback());
  }

  /**
   * [callback description]
   * @type {Function}
   */
  getListenCallback(callback: Function): Function {
    return () => {
      if (callback != null) {
        callback();
      }

      if (process.send) {
        process.send('ready');
      }

      this.logger.info(`Server listening at ${this.config.get('hostname')}:${this.config.get('port')}...`);
    };
  }

  /**
   * [app description]
   * @type {[type]}
   */
  initialize(app: Object): void {
    // Add common request security measures
    app.use(helmet());

    // Enabled CORS (corss-origin resource sharing)
    app.use(cors(this.config.get('cors')));

    // request compression
    app.use(compress(this.config.get('compress')));

    // Initialize body parser before routes or body will be undefined
    app.use(body(this.config.get('body')));

    // Trace a single request process (including over async)
    app.use(transactionMiddleware);

    // Configure Request logging
    app.use(accessLogger);

    // Configure the request error handling
    app.use(errorMiddleware);

    // Serve asset resources using the 'assets' url
    app.use(mount(
      this.config.assets.get('url'),
      serve(this.config.assets.get('path'), this.config.assets.get('options')),
    ));

    // Serve static resources using the 'static' url
    app.use(mount(
      this.config.static.get('url'),
      serve(this.config.static.get('path'), this.config.static.get('options')),
    ));
  }

  /**
   * [destroy description]
   * @param  {[type]} void [description]
   * @return {[type]}      [description]
   */
  destroy(): void {
    // TODO logger destroy?
    process.emit('destroy');
  }

  /**
   * [callback description]
   * @type {Function}
   */
  async start(callback: Function | null = null): void {
    if (!this.app) {
      throw new Error('Cannot start server: the express instance is not defined');
    }

    try {
      return this.createServer().listen(
        this.config.get('port'),
        this.config.get('hostname'),
        this.config.get('backlog'),
        this.getListenCallback(callback),
      );
    } catch (e) {
      this.logger.error(e);
      this.destroy();
      throw e;
    }
  }

  /**
   * [stop description]
   * @param  {Function} callback [description]
   * @return {[type]}            [description]
   */
  stop(callback: Function | null = null): void {
    this.logger.info(`Server (${this.config.hostname}:${this.config.port}) stopping...`);
    this.destroy();

    if (callback) {
      callback();
    }
  }
}
