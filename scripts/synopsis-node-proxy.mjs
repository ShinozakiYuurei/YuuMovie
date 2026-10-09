// Run the Node synopsis scraper with the HK egress proxy injected, so both sides
// see the same pages. wmoov and hkmovie6 answer 403 from this machine without it.
//
// The scraper decides to run from process.argv[1], which is this script's own path,
// so argv is set up to match what a direct invocation would look like.
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const agent = new HttpsProxyAgent('http://127.0.0.1:10010');

globalThis.fetch = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: options.method || 'GET',
        agent,
        headers: { ...(options.headers || {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => buf.toString('utf8'),
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });

// The scraper guards on the script name, so the path has to look like its own.
process.argv[1] = 'synopsis.js';
await import('../scrapers/synopsis.js');