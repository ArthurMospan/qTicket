import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { safeExternalUrl } from '../src/lib/utils/externalUrls.mjs';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_ACCEPT,
  MAX_UPLOAD_BYTES,
  uploadFilePolicy,
} from '../src/lib/utils/uploadPolicy.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('external links accept only absolute HTTP and HTTPS URLs', () => {
  assert.equal(safeExternalUrl(' https://meet.example/room?q=1 '), 'https://meet.example/room?q=1');
  assert.equal(safeExternalUrl('http://youtrack.example/issue/QT-1'), 'http://youtrack.example/issue/QT-1');
  for (const value of [
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    '//example.com/path',
    '/relative/path',
    'https://example.com/space here',
  ]) {
    assert.equal(safeExternalUrl(value), '', value);
  }
});

test('calendar and integration links are guarded while saving and rendering', async () => {
  const [dialog, page, server, linkCard, issueDetail, telegram] = await Promise.all([
    read('../src/components/workspace/calendar/CalendarEventDialog.jsx'),
    read('../src/components/workspace/calendar/CalendarEventPage.jsx'),
    read('../src/lib/server/calendarEvents.js'),
    read('../src/components/workspace/qtplus/cards/LinkCard.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/lib/utils/telegramMessage.mjs'),
  ]);

  assert.match(dialog, /meetingUrl = safeExternalUrl\(typed\.meetingUrl\)/);
  assert.match(dialog, /href=\{safeMeetingUrl\}/);
  assert.match(page, /const meetingUrl = safeExternalUrl\(rawMeetingUrl\)/);
  assert.match(page, /href=\{safeMeetingUrl\}/);
  assert.match(server, /meetingUrl = safeExternalUrl\(typed\.meetingUrl\)/);
  assert.match(linkCard, /const url = safeExternalUrl\(view\.url\)/);
  assert.match(issueDetail, /safeExternalUrl\(issue\.importMetadata\?\.sourceUrl\)/);
  assert.match(telegram, /safeExternalUrl\(item\.url\)/);
  assert.doesNotMatch(dialog, /href=\{event\.meetingUrl\}/);
  assert.doesNotMatch(page, /href=\{event\.meetingUrl\}/);
});

test('attachment policy requires a matching allow-listed extension and MIME', () => {
  assert.deepEqual(uploadFilePolicy({ name: 'photo.png', type: 'image/png', size: 200 }).value, {
    extension: 'png',
    mimeType: 'image/png',
    size: 200,
    resourceType: 'image',
    allowedFormats: ['png'],
  });
  assert.equal(
    uploadFilePolicy({ name: 'recording.ogg', type: 'audio/ogg', size: 200 }).value.resourceType,
    'video',
  );
  assert.equal(
    uploadFilePolicy({ name: 'brief.pdf', type: 'application/pdf', size: 200 }).value.resourceType,
    'raw',
  );
  assert.ok(uploadFilePolicy({ name: 'vector.svg', type: 'image/svg+xml', size: 200 }).error);
  assert.ok(uploadFilePolicy({ name: 'photo.png', type: 'text/html', size: 200 }).error);
  assert.ok(uploadFilePolicy({ name: 'no-extension', type: 'image/png', size: 200 }).error);
  assert.ok(uploadFilePolicy({
    name: 'large.png',
    type: 'image/png',
    size: MAX_UPLOAD_BYTES + 1,
  }).error);
  assert.doesNotMatch(IMAGE_UPLOAD_ACCEPT, /svg/);
  assert.match(ATTACHMENT_UPLOAD_ACCEPT, /application\/pdf/);
});

test('the signed upload route duplicates limits and binds Cloudinary formats', async () => {
  const [route, service, imageUpload] = await Promise.all([
    read('../src/app/api/upload/sign/route.js'),
    read('../src/lib/services/fileUpload.js'),
    read('../src/components/ui/ImageUpload.jsx'),
  ]);

  assert.match(route, /uploadFilePolicy\(params\?\.file\)/);
  assert.match(route, /allowed_formats: filePolicy\.value\.allowedFormats\.join\(','\)/);
  assert.match(service, /file: \{ name: file\.name, size: file\.size, type: file\.type \}/);
  assert.match(service, /formData\.append\('allowed_formats', allowedFormats\.join\(','\)\)/);
  assert.match(service, /uploadedBytes > MAX_UPLOAD_BYTES/);
  assert.match(imageUpload, /accept=\{IMAGE_UPLOAD_ACCEPT\}/);
  assert.doesNotMatch(imageUpload, /accept="image\/\*"/);
});
