/**
 * AgentMail Client - 发送邮件回复
 */

const https = require('https');

class AgentMailClient {
  constructor(apiKey, inboxId) {
    this.apiKey = apiKey;
    this.inboxId = inboxId;
    this.baseUrl = 'api.agentmail.to';
    this.apiVersion = '/v0';
  }

  /**
   * 发送回复邮件
   */
  async sendReply({ to, subject, text }) {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const html = `<p>${text.replace(/\n/g, '<br>')}</p>`;

    const postData = JSON.stringify({
      inbox_id: this.inboxId,
      to: Array.isArray(to) ? to : [to],
      subject: text,
      text: signedText,
      html
    });

    return this._request('POST', `/inboxes/${encodeURIComponent(this.inboxId)}/messages/send`, postData);
  }

  /**
   * 内部 HTTP 请求
   */
  _request(method, path, postData = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path: this.apiVersion + path,
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      console.log(`[AgentMail] ${method} ${path}`);
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ success: true, raw: data });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }
}

module.exports = { AgentMailClient };
