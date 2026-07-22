import { serve } from '@hono/node-server';
import { createDashboardFixtureApp } from './dashboard-fixtures.js';

const port = 8791;
serve({ fetch: createDashboardFixtureApp().fetch, port, hostname: '127.0.0.1' });
console.log(`Dashboard fixtures listening on http://127.0.0.1:${port}/dashboard/normal`);
