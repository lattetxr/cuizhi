import { createServer } from './server.mjs';

const app = createServer();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    
    return env.ASSETS.fetch(request);
  }
};
