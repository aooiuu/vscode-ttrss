import got from 'got';
import { config } from './config';

class TTRSS {
  public url?: string;
  public sid?: string;

  async login() {
    this.url = config.app.get('url', '').replace(/\/+$/, '/api');
    const user = config.app.get('user');
    const password = config.app.get('password');
    if (!user || !password) {
      return;
    }
    const res = await this.fetch({
      op: 'login',
      user,
      password
    });
    this.sid = res.content.session_id;
  }

  async fetch(params: any) {
    if (!this.sid && params.op !== 'login') {
      await this.login();
    }
    const res: any = await got({
      url: this.url,
      method: 'POST',
      json: {
        ...params,
        sid: this.sid
      }
    }).catch((err) => console.warn(err));
    if (!res) {
      return;
    }
    try {
      const response = JSON.parse(res.body);
      return response;
    } catch (error) {
      console.warn(error);
    }
  }
}

export default new TTRSS();
