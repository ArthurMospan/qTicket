import 'server-only';

import { normalizeYouTrackBaseUrl } from '@/lib/utils/youtrackImport.mjs';

const USER_FIELDS = 'id,login,name,fullName,email,avatarUrl,banned';
const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'summary',
  'description',
  'created',
  'updated',
  'resolved',
  `reporter(${USER_FIELDS})`,
  `updater(${USER_FIELDS})`,
  `watchers(users(${USER_FIELDS}))`,
  'tags(id,name)',
  'customFields(id,name,$type,value(id,name,login,fullName,email,presentation,text,minutes,timestamp))',
].join(',');

function apiUrl(baseUrl, path, params = {}) {
  const url = new URL(`${baseUrl}/api/${String(path).replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

export class YouTrackClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = normalizeYouTrackBaseUrl(baseUrl);
    this.token = String(token || '').trim();
    this.fetchImpl = fetchImpl;
    if (!this.token) throw new Error('Вкажіть постійний токен YouTrack');
  }

  async request(path, { params, timeoutMs = 20_000 } = {}) {
    const response = await this.fetchImpl(apiUrl(this.baseUrl, path, params), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      const error = new Error(`YouTrack ${response.status}: ${detail || response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async listAll(path, { fields, query, top = 100, limit = 20_000 } = {}) {
    const result = [];
    for (let skip = 0; skip < limit; skip += top) {
      const page = await this.request(path, {
        params: { fields, query, $top: top, $skip: skip },
      });
      if (!Array.isArray(page)) throw new Error('YouTrack повернув некоректний список');
      result.push(...page);
      if (page.length < top) break;
    }
    return result.slice(0, limit);
  }

  async me() {
    return this.request('users/me', { params: { fields: USER_FIELDS } });
  }

  async projects() {
    return this.listAll('admin/projects', {
      fields: `id,name,shortName,description,archived,leader(${USER_FIELDS}),customFields(id,$type,field(id,name),bundle(id,$type))`,
      top: 100,
      limit: 5_000,
    });
  }

  async stateBundle(bundleId) {
    try {
      return await this.request(`admin/customFieldSettings/bundles/state/${encodeURIComponent(bundleId)}`, {
        params: { fields: 'id,values(id,name,archived,ordinal)' },
      });
    } catch (error) {
      if (error.status === 403 || error.status === 404) return null;
      throw error;
    }
  }

  async users() {
    try {
      return await this.listAll('users', { fields: USER_FIELDS, top: 100, limit: 20_000 });
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404) return [];
      throw error;
    }
  }

  async issueStubs(projectShortName) {
    return this.listAll('issues', {
      fields: 'id,idReadable,summary,created,updated,customFields(name,$type,value(name,presentation))',
      query: `project: {${projectShortName}} sort by: created asc`,
      top: 100,
      limit: 50_000,
    });
  }

  async issue(issueId) {
    return this.request(`issues/${encodeURIComponent(issueId)}`, {
      params: { fields: ISSUE_FIELDS },
    });
  }

  async comments(issueId) {
    return this.listAll(`issues/${encodeURIComponent(issueId)}/comments`, {
      fields: `id,text,created,updated,deleted,author(${USER_FIELDS})`,
      top: 100,
      limit: 20_000,
    });
  }

  async workItems(issueId) {
    try {
      return await this.listAll(`issues/${encodeURIComponent(issueId)}/timeTracking/workItems`, {
        fields: `id,date,duration(minutes,presentation),text,type(id,name),created,updated,author(${USER_FIELDS}),creator(${USER_FIELDS})`,
        top: 100,
        limit: 20_000,
      });
    } catch (error) {
      if (error.status === 403 || error.status === 404) return [];
      throw error;
    }
  }

  async attachments(issueId) {
    try {
      return await this.listAll(`issues/${encodeURIComponent(issueId)}/attachments`, {
        fields: `id,name,url,size,mimeType,created,updated,author(${USER_FIELDS})`,
        top: 100,
        limit: 5_000,
      });
    } catch (error) {
      if (error.status === 403 || error.status === 404) return [];
      throw error;
    }
  }

  async links(issueId) {
    try {
      return await this.listAll(`issues/${encodeURIComponent(issueId)}/links`, {
        fields: 'id,direction,linkType(id,name,sourceToTarget,targetToSource,directed),issues(id,idReadable)',
        top: 100,
        limit: 5_000,
      });
    } catch (error) {
      if (error.status === 403 || error.status === 404) return [];
      throw error;
    }
  }

  async downloadAttachment(url, { maxBytes = 20 * 1024 * 1024 } = {}) {
    const target = new URL(url, `${this.baseUrl}/`);
    const source = new URL(this.baseUrl);
    if (target.origin !== source.origin) throw new Error('YouTrack attachment points to another origin');
    const response = await this.fetchImpl(target, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Не вдалося завантажити вкладення: ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Вкладення перевищує 20 MB');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('Вкладення перевищує 20 MB');
    return {
      bytes,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  }
}
