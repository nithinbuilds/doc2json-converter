import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PLUSH_ORIGIN = 'https://www.plush.shop';
const TURNSTILE_SITE_KEY = '0x4AAAAAAEW4nd-PY7TmJvry';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
  'chromium-browser',
].filter(Boolean);

const VERIFY_HUMAN = `
  mutation verifyHuman($input: VerifyHumanInput!) {
    verifyHuman(input: $input) {
      ticket
      expiresAt
    }
  }
`;

const CREATE_CHAT = `
  mutation {
    createChat {
      chat { id }
    }
  }
`;

const SEND_CHAT_MESSAGE = `
  mutation SendChatMessage($input: SendChatMessageInput!) {
    sendChatMessage(input: $input) {
      result
    }
  }
`;

const CHAT_MESSAGES = `
  query ChatMessages($id: ID!) {
    chat(id: $id) {
      id
      messages(last: 30) {
        edges {
          node {
            __typename
            ... on ItemSearchResultMessage {
              searchResultInfo {
                searchID
                images
              }
            }
            ... on ItemMessage {
              item {
                id
                name
                thumbnailImage
                itemBrand { name }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_RESULT_BY_SEARCH_ID = `
  query GetResultBySearchId($input: GetResultBySearchIdInput!) {
    getResultBySearchId(input: $input) {
      items {
        edges {
          node {
            id
            name
            thumbnailImage
            itemBrand { name }
          }
        }
      }
    }
  }
`;

/** Reuse one verified session across carousel fetches in the same Node process. */
let sessionCache = null; // { ticket, expiresAt, deviceId }

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
    if (!candidate.includes('/')) return candidate;
  }
  return null;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();

    ws.onopen = () => {
      resolve({
        send(method, params = {}, sessionId) {
          const id = ++nextId;
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify(payload));
          });
        },
        close() {
          try {
            ws.close();
          } catch {}
        },
      });
    };
    ws.onerror = (err) => reject(err);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data.id || !pending.has(data.id)) return;
      const { res, rej } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) rej(new Error(JSON.stringify(data.error)));
      else res(data.result);
    };
  });
}

async function withChromePage(fn) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Google Chrome or set CHROME_PATH to fetch chat products.'
    );
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plush-chat-'));
  const port = 9222 + Math.floor(Math.random() * 1000);
  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1200,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    let version;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
        if (version?.webSocketDebuggerUrl) break;
      } catch {}
    }
    if (!version?.webSocketDebuggerUrl) {
      throw new Error('Chrome DevTools endpoint did not start');
    }

    const browser = await cdpConnect(version.webSocketDebuggerUrl);
    const { targetId } = await browser.send('Target.createTarget', { url: PLUSH_ORIGIN });
    const { sessionId } = await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const send = (method, params) => browser.send(method, params, sessionId);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: PLUSH_ORIGIN });
    await new Promise((r) => setTimeout(r, 3500));

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ||
            JSON.stringify(result.exceptionDetails)
        );
      }
      return result.result?.value;
    };

    try {
      return await fn({ evaluate, browser, send });
    } finally {
      browser.close();
    }
  } finally {
    try {
      chrome.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

function toOidEntry(node) {
  return {
    $oid: node.id,
    imageUrl: node.thumbnailImage || null,
    name: node.itemBrand?.name || node.name,
  };
}

/**
 * Chat-based product fetch for a natural-language prompt:
 * Turnstile → verifyHuman → createChat → sendChatMessage → getResultBySearchId
 */
export async function fetchProductsViaChat(prompt, { limit = 8 } = {}) {
  const query = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!query) throw new Error('Search query is required');

  const cached =
    sessionCache && sessionCache.expiresAt - Date.now() > 60_000 ? sessionCache : null;

  const payload = await withChromePage(async ({ evaluate }) => {
    return evaluate(`(async () => {
      const sitekey = ${JSON.stringify(TURNSTILE_SITE_KEY)};
      const prompt = ${JSON.stringify(query)};
      const limit = ${Number(limit) || 8};
      let ticket = ${JSON.stringify(cached?.ticket || null)};
      let deviceId = ${JSON.stringify(cached?.deviceId || null)};
      let expiresAt = ${Number(cached?.expiresAt || 0)};

      if (!deviceId) {
        deviceId = (document.cookie.match(/p_device_id=([^;]+)/) || [])[1] || crypto.randomUUID();
      }

      const gql = async (queryDoc, variables) => {
        const headers = {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        };
        if (ticket) headers['X-Human-Ticket'] = ticket;
        const res = await fetch('/api/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: queryDoc, variables }),
        });
        return res.json();
      };

      if (!ticket) {
        await new Promise((resolve, reject) => {
          if (window.turnstile) return resolve();
          const s = document.createElement('script');
          s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          s.onload = resolve;
          s.onerror = () => reject(new Error('Failed to load Turnstile'));
          document.head.appendChild(s);
        });

        const host = document.createElement('div');
        document.body.appendChild(host);
        const token = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Turnstile timed out')), 45000);
          window.turnstile.render(host, {
            sitekey,
            action: 'verify_human',
            callback: (tok) => { clearTimeout(timer); resolve(tok); },
            'error-callback': (code) => {
              clearTimeout(timer);
              reject(new Error('Turnstile error ' + code));
            },
          });
        });

        const verify = await gql(${JSON.stringify(VERIFY_HUMAN)}, { input: { token } });
        ticket = verify.data?.verifyHuman?.ticket;
        expiresAt = Date.parse(verify.data?.verifyHuman?.expiresAt || '') || (Date.now() + 25 * 60 * 1000);
        if (!ticket) {
          throw new Error(verify.errors?.[0]?.message || 'verifyHuman returned no ticket');
        }
      }

      const created = await gql(${JSON.stringify(CREATE_CHAT)});
      const chatId = created.data?.createChat?.chat?.id;
      if (!chatId) {
        throw new Error(created.errors?.[0]?.message || 'createChat failed');
      }

      const sent = await gql(${JSON.stringify(SEND_CHAT_MESSAGE)}, {
        input: { chatID: chatId, text: prompt },
      });
      if (sent.errors?.length) {
        throw new Error(sent.errors[0].message || 'sendChatMessage failed');
      }

      let searchID = null;
      let directItems = [];
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await gql(${JSON.stringify(CHAT_MESSAGES)}, { id: chatId });
        if (poll.errors?.length) {
          throw new Error(poll.errors[0].message || 'chat poll failed');
        }
        const nodes = poll.data?.chat?.messages?.edges?.map((e) => e.node) || [];
        directItems = nodes.filter((n) => n.item?.id).map((n) => n.item);
        const searchMsg = nodes.find((n) => n.searchResultInfo?.searchID);
        if (directItems.length >= limit) {
          return {
            ticket,
            expiresAt,
            deviceId,
            chatId,
            searchID,
            items: directItems.slice(0, limit),
          };
        }
        if (searchMsg) {
          searchID = searchMsg.searchResultInfo.searchID;
          break;
        }
      }

      if (!searchID) {
        return {
          ticket,
          expiresAt,
          deviceId,
          chatId,
          searchID: null,
          items: directItems.slice(0, limit),
        };
      }

      const result = await gql(${JSON.stringify(GET_RESULT_BY_SEARCH_ID)}, {
        input: { id: searchID, first: limit },
      });
      if (result.errors?.length) {
        throw new Error(result.errors[0].message || 'getResultBySearchId failed');
      }
      const edges = result.data?.getResultBySearchId?.items?.edges || [];
      const items = edges.map((e) => e.node).filter((n) => n?.id);
      return {
        ticket,
        expiresAt,
        deviceId,
        chatId,
        searchID,
        items: items.slice(0, limit),
      };
    })()`);
  });

  sessionCache = {
    ticket: payload.ticket,
    expiresAt: payload.expiresAt,
    deviceId: payload.deviceId,
  };

  const oids = (payload.items || []).map(toOidEntry);
  return {
    oids,
    query,
    found: oids.length,
    source: 'chat',
    chatId: payload.chatId,
    searchID: payload.searchID,
  };
}
