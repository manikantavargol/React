const session = require("express-session");
const RedisStore = require("connect-redis")(session);
const Router = require("express").Router;

class OAuthRoute {
  constructor(config, cache, auth) {
    this.config = config;
    this.cache = cache;
    this.auth = auth;
    this.cookie = "next.dashboard.api";
  }

  static get $provides() {
    return "route.oauth";
  }

  static get $requires() {
    return ["config", "cache", "auth"];
  }

  async init() {
    const store = new RedisStore({
      client: this.cache.cacheRedis,
      disableTouch: true
    });

    this.sessionMiddleware = session({
      name: this.cookie,
      secret: this.config.jwtSecret,
      store,
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
        maxAge: 60 * 60 * 1000
      }
    });

    this.router = Router();
    for (let provider of this.auth.providers) {
      // Add routes for each provider

      this.router.get(
        // Route to start sign in
        `/oauth/${provider.providerName}`,
        this.sessionMiddleware,
        this.saveToken(provider.providerName),
        this.authenticate(provider.providerName, provider.providerOptions)
      );

      this.router.get(
        // Route to call back to after signing in
        `/oauth/${provider.providerName}/callback`,
        this.sessionMiddleware,
        this.authenticate(provider.providerName, {
          failureRedirect: this.config.apiAppServer + "/auth/error?type=oauth"
        }),
        this.successRedirect(provider.providerName)
      );
    }
  }

  saveToken(/* provider */) {
    return async (req, res, next) => {
      let token = req.query.token || "";
      if (token) {
        const { type, user, client } = (await this.auth.useToken(token)) || {};
        if (type === "oneTime") {
          /* eslint-disable require-atomic-updates */
          req.session.userId = user.id;
          req.session.clientId = client.id;
          /* eslint-enable require-atomic-updates */
        }
      } else {
        req.session.userId = null;
        req.session.clientId = null;
      }

      // eslint-disable-next-line require-atomic-updates
      req.session.redirect = req.query.redirect || "";

      next();
    };
  }

  authenticate(...args) {
    return (req, res, next) => {
      this.auth.passport.initialize()(req, res, error => {
        if (error) return next(error);
        this.auth.passport.authenticate(...args)(req, res, next);
      });
    };
  }

  successRedirect(/* provider */) {
    return async (req, res, next) => {
      req.session.userId = null;
      req.session.clientId = null;

      if (!req.user || !req.client)
        return res.redirect(this.config.apiAppServer + "/auth/error");

      let token = await this.auth.createToken("oneTime", req.user, req.client);
      let redirect = req.session.redirect || "";
      res.redirect(
        this.config.apiAppServer +
          "/auth/return?token=" +
          encodeURIComponent(token) +
          (redirect ? "&redirect=" + encodeURIComponent(redirect) : "")
      );
    };
  }
}

module.exports = OAuthRoute;
