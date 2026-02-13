/**
 * Mail Channel - 混合版：AgentMail 收 + Resend 发
 * 
 * 流程：
 * 收到邮件(AgentMail webhook) → 解析身份 → 发送到 OpenClaw session → 用 Resend 回复
 */

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// 配置
const CONFIG_FILE = path.join(__dirname, 'config.json');
const OPENCLAW_CONFIG_PATH = '/home/caiwei/.openclaw/openclaw.json';

// 加载配置
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (err) {
  console.error('[Config] 无法加载配置文件:', CONFIG_FILE);
  console.error('[Config] 请复制 config.example.json 到 config.json 并填写配置');
  process.exit(1);
}

const PORT = process.env.PORT || 8789;

// 加载 Resend Client（用于发送）
const { ResendClient } = require('./resend-client');
const resendClient = new ResendClient(
  config.resend.apiKey,
  config.resend.fromEmail
);

// 加载 identityLinks（从 openclaw.json 读取）
function loadIdentityLinks() {
  try {
    const openclawConfig = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
    return openclawConfig.session?.identityLinks || {};
  } catch (err) {
    console.warn('[Identity] 无法读取 openclaw.json:', err.message);
    return {};
  }
}

// 根据邮箱查找 userId
function findUserIdByEmail(email) {
  const identityLinks = loadIdentityLinks();
  const normalizedEmail = email.toLowerCase().trim();
  
  for (const [userId, links] of Object.entries(identityLinks)) {
    for (const link of links) {
      if (link.startsWith('email:')) {
        const linkEmail = link.slice(6).toLowerCase().trim();
        if (linkEmail === normalizedEmail) {
          return userId;
        }
      }
    }
  }
  return null;
}

// 提取邮箱和姓名
function extractEmail(fromField) {
  if (!fromField) {
    return { email: 'unknown', name: 'Unknown' };
  }

  let from = fromField;
  if (Array.isArray(fromField) && fromField.length > 0) {
    from = fromField[0];
  }

  if (typeof from === 'object') {
    return {
      email: (from.email || from.address || '').toLowerCase(),
      name: from.name || from.email || 'Unknown'
    };
  }

  if (typeof from === 'string') {
    const match = from.match(/<([^>]+)>/);
    if (match) {
      return {
        email: match[1].toLowerCase(),
        name: from.split('<')[0].trim()
      };
    }
    return { email: from.toLowerCase(), name: from };
  }

  return { email: 'unknown', name: 'Unknown' };
}

// 从 sessions.json 获取 session 的 uuid
function getSessionUuid(sessionKey) {
  try {
    const sessionsPath = '/home/caiwei/.openclaw/agents/main/sessions/sessions.json';
    const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    return sessions[sessionKey]?.sessionId || null;
  } catch (err) {
    console.warn(`[Session] 无法读取 sessions.json: ${err.message}`);
    return null;
  }
}

// 发送消息到 OpenClaw session
async function sendToSession(userId, message) {
  const sessionKey = `agent:main:${userId}`;
  const sessionUuid = getSessionUuid(sessionKey);
  
  if (!sessionUuid) {
    throw new Error(`Session ${sessionKey} 不存在，请先通过 web 端创建 session`);
  }
  
  const escapedMessage = message.replace(/"/g, '\\"');
  
  // 使用 uuid 作为 --session-id，确保写入正确的 session 文件
  const cmd = `/home/caiwei/.nvm/versions/node/v24.13.1/bin/openclaw agent --session-id "${sessionUuid}" --message "${escapedMessage}" --timeout 120`;
  
  console.log(`[Session] 发送到 ${sessionKey} (uuid: ${sessionUuid})...`);
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { 
      timeout: 120000,
      env: { ...process.env }
    });
    
    if (stderr && !stderr.includes('info') && !stderr.includes('warn')) {
      console.warn('[Session] stderr:', stderr);
    }
    
    return stdout.trim();
  } catch (error) {
    console.error('[Session] 发送失败:', error.message);
    throw error;
  }
}

// 重置 session（发送 /new）
async function resetSession(userId) {
  const sessionKey = `agent:main:${userId}`;
  const sessionUuid = getSessionUuid(sessionKey);
  
  if (!sessionUuid) {
    console.warn(`[Session] ${sessionKey} 不存在，跳过重置`);
    return false;
  }
  
  const cmd = `/home/caiwei/.nvm/versions/node/v24.13.1/bin/openclaw agent --session-id "${sessionUuid}" --message "/new" --timeout 30`;
  
  console.log(`[Session] 重置 ${sessionKey} (uuid: ${sessionUuid})...`);
  
  try {
    await execAsync(cmd, { timeout: 30000 });
    return true;
  } catch (error) {
    console.error('[Session] 重置失败:', error.message);
    return false;
  }
}

// 处理收到的邮件（AgentMail webhook 格式）
async function processEmail(email) {
  const sender = extractEmail(email.from || email.from_);
  const userId = findUserIdByEmail(sender.email);
  
  console.log(`\n[Mail] 收到邮件 from ${sender.name} <${sender.email}>`);
  console.log(`[Mail] 主题: ${email.subject}`);
  
  if (!userId) {
    console.log(`[Mail] 未知发件人，忽略: ${sender.email}`);
    return { success: false, error: 'Unknown sender' };
  }
  
  console.log(`[Mail] 识别为用户: ${userId}`);
  
  // 处理 NEW 命令
  if (email.subject?.trim() === 'NEW') {
    console.log('[Mail] 收到 NEW 命令，重置 session...');
    const reset = await resetSession(userId);
    if (reset) {
      await resendClient.sendReply({
        to: sender.email,
        subject: email.subject,
        text: 'Session 已重置。',
        inReplyTo: email.messageId
      });
    }
    return { success: true, reset: true };
  }
  
  // 构建消息
  const messageParts = [
    `📧 收到来自 ${sender.name} (${userId}) <${sender.email}> 的邮件`,
    `主题: ${email.subject}`,
    '---',
    email.text || email.preview || '(无正文)',
    '---',
    `【重要】如果需要回复这封邮件，请直接回复。你的回复会发送到: ${sender.email}`,
    `如果不需要回复，请只回复 NO_REPLY。`
  ];
  
  const message = messageParts.join('\n\n');
  
  try {
    // 发送到 session
    const response = await sendToSession(userId, message);
    
    // 如果有回复且不是 NO_REPLY，用 Resend 发送邮件
    if (response && response.trim() && response !== 'NO_REPLY') {
      console.log(`[Mail] 发送回复 (${response.length} 字符) via Resend`);
      await resendClient.sendReply({
        to: sender.email,
        subject: email.subject,
        text: response,
        inReplyTo: email.messageId
      });
    } else {
      console.log('[Mail] Agent 返回 NO_REPLY，不发送邮件');
    }
    
    return { 
      success: true, 
      userId, 
      hasReply: !!(response && response.trim() && response !== 'NO_REPLY')
    };
  } catch (error) {
    console.error('[Mail] 处理失败:', error);
    
    // 用 Resend 发送错误回复
    try {
      await resendClient.sendReply({
        to: sender.email,
        subject: email.subject,
        text: `抱歉，处理您的邮件时出现了问题。\n\n错误信息: ${error.message}`,
        inReplyTo: email.messageId
      });
    } catch (replyError) {
      console.error('[Mail] 发送错误回复也失败:', replyError);
    }
    
    return { success: false, error: error.message };
  }
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 健康检查
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });  
    res.end(JSON.stringify({ 
      status: 'ok',
      receive: 'AgentMail',
      send: 'Resend',
      from: config.resend?.fromEmail
    }));
    return;
  }
  
  // Webhook 处理（AgentMail 格式）
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      
      // AgentMail webhook 格式: { event_type: 'message.received', message: { ... } }
      if (payload.event_type === 'message.received' && payload.message) {
        const msg = payload.message;
        const email = {
          messageId: msg.message_id,
          inReplyTo: msg.in_reply_to,
          from: msg.from_,
          to: msg.to,
          subject: msg.subject || '(无主题)',
          text: msg.text,
          preview: msg.preview,
          timestamp: msg.timestamp || new Date().toISOString()
        };
        
        const result = await processEmail(email);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, processed: false, type: payload.event_type }));
      }
    } catch (err) {
      console.error('[Server] Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

// 启动
async function start() {
  console.log('='.repeat(60));
  console.log('  OpenClaw Mail Channel v2.0 (Hybrid)');
  console.log('  Receive: AgentMail | Send: Resend');
  console.log('='.repeat(60));
  console.log(`\n  Send From: ${config.resend.fromEmail}`);
  
  // 显示已配置的用户
  const identityLinks = loadIdentityLinks();
  const users = Object.keys(identityLinks);
  console.log(`  已配置用户: ${users.length > 0 ? users.join(', ') : '(无)'}`);
  
  // 启动服务器
  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`\n  ✓ 服务已启动: http://localhost:${PORT}`);
      resolve();
    });
  });
  
  console.log('\n  Webhook 模式已启用');
  console.log('  1. 确保 ngrok 正在运行:');
  console.log(`       ngrok http ${PORT}`);
  console.log('  2. 在 AgentMail 设置 webhook URL');
  console.log('  3. Resend 仅用于发送回复');
  
  console.log('\n' + '='.repeat(60));
  console.log('  按 Ctrl+C 停止');
  console.log('='.repeat(60) + '\n');
}

// 优雅退出
function shutdown() {
  console.log('\n[Server] 正在关闭...');
  server.close(() => {
    console.log('[Server] 已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 启动
start().catch((err) => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
