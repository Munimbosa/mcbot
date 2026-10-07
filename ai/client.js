'use strict';

class AIClient {
  constructor(options = {}) {
    this.baseUrl = options.url || 'http://127.0.0.1:8080';
    this.model = options.model || 'qwen.gguf';
    this.timeoutMs = options.timeoutMs || 12000;
  }

  async sendCompletion(messages, maxTokens = 80) {
    const cleanUrl = this.baseUrl.replace(/\/+$/, '');
    const endpoint = cleanUrl + '/v1/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: messages,
          max_tokens: maxTokens,
          temperature: 0.6
        })
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[AI-Client] HTTP error ' + response.status + ': ' + errText);
        return { success: false, error: 'HTTP ' + response.status };
      }

      const data = await response.json();
      const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

      return {
        success: true,
        content: content.trim()
      };
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error.name === 'AbortError';
      const errMsg = isAbort ? 'Request timed out after ' + this.timeoutMs + 'ms' : error.message;
      console.error('[AI-Client] Request failed: ' + errMsg);
      return { success: false, error: errMsg, isTimeout: isAbort };
    }
  }

  async checkHealth() {
    try {
      const cleanUrl = this.baseUrl.replace(/\/+$/, '');
      const endpoint = cleanUrl + '/health';
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

module.exports = AIClient;
