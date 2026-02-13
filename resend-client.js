/**
 * Resend Client - 发送邮件回复
 */

const https = require('https');

class ResendClient {
  constructor(apiKey, fromEmail) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;  // 你的域名邮箱，如 noreply@yourdomain.com
    this.baseUrl = 'api.resend.com';
  }

  /**
   * 发送回复邮件
   */
  async sendReply({ to, subject, text, inReplyTo }) {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const signedText = text + '\n\n🏔️ 山海';

    const postData = JSON.stringify({
      from: this.fromEmail,
      to: to,
      subject: replySubject,
      text: signedText,
      html: `<p>${text.replace(/\n/g, '<br>')}</p><p>🏔️ 山海</p>`,
      ...(inReplyTo ? { headers: { 'In-Reply-To': inReplyTo } } : {})
    });

    return this._request('POST', '/emails', postData);
  }

  /**
   * 内部 HTTP 请求
   */
  _request(method, path, postData = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path: path,
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      console.log(`[Resend] ${method} ${path}`);
      
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

module.exports = { ResendClient };
