const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 5) throw Error('Use up to five automatic replies per connection.');
  const result = new Map();
  for (const rule of rules) {
    const prompt = rule.prompt.trim();
    if (!prompt || prompt.length > 1000 || !rule.answer || Buffer.byteLength(rule.answer) > 1023 || /[\r\n\0]/.test(rule.answer) || result.has(prompt)) {
      throw Error('Enter distinct prompts and single-line replies.');
    }
    result.set(prompt, rule.answer);
  }
  return result;
}

async function open(directory, rules, processId, notify, password = '', onPasswordUsed = () => {}) {
  let sentConnectionPassword = false;
  const socketPath = path.join(directory, 'ask');
  const clients = new Set();
  const pending = new Map();
  function reply(id, value) {
    const client = pending.get(id);
    if (!client) return false;
    pending.delete(id);
    if (typeof value !== 'string' || Buffer.byteLength(value) > 1023 || /[\r\n\0]/.test(value)) client.end();
    else client.end(value + '\n');
    return true;
  }
  const server = net.createServer({ allowHalfOpen: true }, client => {
    clients.add(client);
    client.setEncoding('utf8');
    client.on('error', () => client.destroy());
    let request = '';
    let id;
    client.once('close', () => {
      clients.delete(client);
      if (id && pending.delete(id)) notify('prompt-clear', id);
    });
    client.on('data', chunk => {
      request += chunk;
      if (request.length > 16000) return client.destroy();
      if (request.split('\n').length < 4) return;
      client.removeAllListeners('data');
      const [pid, hint, encoded] = request.split('\n');
      const prompt = Buffer.from(encoded, 'base64').toString('utf8').trim();
      // Apply PAM rules only to questions from the target OpenSSH process.
      const question = prompt.replace(/^\([^\r\n)]{1,512}\) /, '');
      const match = rules.has(prompt) ? prompt : question;
      const targetProcess = Number(pid) === processId();
      // OpenSSH's host-key confirmation can arrive without an askpass hint.
      const hostKey = /^The authenticity of host .+ can't be established\.$/m.test(prompt) &&
        /^Are you sure you want to continue connecting \(yes\/no(?:\/\[fingerprint\])?\)\?$/.test(prompt.split('\n').at(-1));
      const finalPrompt = prompt.trim().split(/\r?\n/).at(-1);
      const isPasswordPrompt = /^(?:(?:.+?['’]s\s+)|(?:enter\s+))?password(?:\s+for\s+.+)?:\s*$/i.test(finalPrompt);
      if (targetProcess && isPasswordPrompt && password && !sentConnectionPassword) {
        try { onPasswordUsed(); }
        catch { client.end(); return; }
        sentConnectionPassword = true;
        client.end(password + '\n');
        return;
      }
      const canRemember = hint === '' && targetProcess && !hostKey;
      if (canRemember && rules.has(match)) {
        const answer = rules.get(match);
        rules.delete(match);
        client.end(answer + '\n');
        notify('auto-answer', { question, source: 'Connection rule' });
        return;
      }
      if (hint === 'none') {
        notify('auth-info', prompt);
        client.end();
        return;
      }
      id = randomUUID();
      pending.set(id, client);
      notify('prompt', { id, prompt, hint, canRemember, targetProcess, hostKey,
        repeatedConnectionPassword: targetProcess && isPasswordPrompt && sentConnectionPassword });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return {
    env: {
      SSH_ASKPASS: path.join(__dirname, 'askpass.sh'),
      SSH_ASKPASS_REQUIRE: 'force',
      PROMEFTP_ASKPASS_SOCKET: socketPath,
    },
    reply,
    clear() { rules.clear(); },
    close() {
      rules.clear();
      for (const client of clients) client.destroy();
      server.close();
    },
  };
}
module.exports = { validateRules, open };
