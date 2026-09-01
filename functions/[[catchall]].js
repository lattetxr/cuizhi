import { createServer } from '../server.mjs';

const app = createServer();

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  
  // Handle API and auth routes through the Express app
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) {
    return app.fetch(context.request, context.env, context);
  }
  
  // For static assets, use the default asset handling
  return context.next();
};
