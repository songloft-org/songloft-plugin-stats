/**
 * API 请求封装
 * SongloftPlugin 由主程序自动注入（提供 apiGet/apiPost 并自动附带 JWT）
 */
export const apiGet = (typeof SongloftPlugin !== 'undefined' && SongloftPlugin.apiGet)
  ? SongloftPlugin.apiGet
  : async (url) => (await fetch(url)).json();

export const apiPost = (typeof SongloftPlugin !== 'undefined' && SongloftPlugin.apiPost)
  ? SongloftPlugin.apiPost
  : async (url, data) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return resp.json();
    };
