import test from 'node:test';
import assert from 'node:assert/strict';
import { runUpdate, DEFAULT_TIMING } from '../updater.mjs';
import { decodeFrame, WRITE_FINISH, CHECK_FINISH, STOCK, upgradeCommand } from '../protocol.mjs';
import { mockUpdater, request, equalBytes } from './helpers.mjs';

test('two stock phases, duplicate/out-of-order reads, exact identity and bounded progress', async () => {
  const mock = mockUpdater(); const before = Uint8Array.from(mock.image);
  const result = await runUpdate(mock.config, mock.options);
  assert.equal(result.state, 'succeeded'); assert.equal(result.transfer_finished, true);
  assert.equal(result.boot_identity_verified, true); assert.equal(result.readback_verified, false);
  assert.deepEqual(mock.image, before); assert.equal(mock.opens, 3); assert.equal(mock.closed, 3);
  assert.deepEqual(mock.transitions.map(step => step.phase), ['entering_check', 'checking', 'waiting_loader', 'entering_write', 'writing', 'waiting_reboot', 'done']);
  assert.equal(mock.transitions[0].state, 'active');
  const replies = mock.sent.filter(packet => { try { return decodeFrame(packet)[2] === 0x30; } catch { return false; } });
  const firstDuplicate = decodeFrame(replies[2]), secondDuplicate = decodeFrame(replies[4]);
  assert.deepEqual(firstDuplicate, secondDuplicate);
  const writing = mock.events.find(event => event.phase === 'writing' && event.requests > 0);
  assert.ok(writing.progress > 0 && writing.progress < 0.01);
  assert.equal(mock.events.some(event => event.progress === 1), true);
  assert.ok(mock.events.length < 50);
});
test('journal is durable before first upgrade and caller cannot mutate image while handshaking', async () => {
  const mock = mockUpdater(); const originalOpen = mock.backend.open;
  mock.backend.open = async pair => {
    mock.image.fill(0xff); const link = await originalOpen(pair); const originalSend = link.send;
    link.send = async packet => {
      if (equalBytes(packet, upgradeCommand())) assert.equal(mock.journal.record.state, 'active');
      return originalSend(packet);
    };
    return link;
  };
  await runUpdate(mock.config, mock.options);
  const response = mock.sent.find(packet => { try { const raw = decodeFrame(packet); return raw[2] === 0x30 && raw.length === 62; } catch { return false; } });
  assert.equal(decodeFrame(response)[14], 0); assert.equal(decodeFrame(response)[15], 1);
});
test('identity failure and wrong initial model never send upgrade', async () => {
  for (const initialIdentity of ['Other_014', 'FM-1_bad', 'ota-FM-1_009']) {
    const mock = mockUpdater({ initialIdentity });
    await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'failed' && !error.destructive_started);
    assert.equal(mock.sent.some(packet => equalBytes(packet, upgradeCommand())), false);
  }
});
test('every ambiguous send failure after attempted upgrade latches unknown', async () => {
  for (const failSendAt of [2, 3, 4, 5, 6, 7, 10, 11]) {
    const mock = mockUpdater({ failSendAt });
    await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'unknown' && error.recovery_required && error.destructive_started);
    assert.equal(mock.journal.record.state, 'unknown'); assert.equal(mock.journal.record.boot_identity_verified, undefined);
    if (failSendAt === 11) assert.equal(mock.journal.record.transfer_finished, true);
  }
});
test('pre-upgrade lost send remains failed, native send exceptions become unknown after upgrade', async () => {
  let mock = mockUpdater({ failSendAt: 1 });
  await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'failed' && !error.recovery_required);
  mock = mockUpdater({ throwSendAt: 2 });
  await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'unknown' && error.recovery_required);
});
test('malformed, zero length, oversized and wrong-phase pulls cannot proceed', async () => {
  for (const packet of [request(0, 0), request(0, 513), request(STOCK.logicalBytes - 1, 2), request(WRITE_FINISH, 8), request(CHECK_FINISH, 7), Uint8Array.from([240, 1, 247])]) {
    const mock = mockUpdater({ checkRequests: [packet] });
    await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'unknown' && !error.transfer_finished);
    assert.equal(mock.sent.length, 2);
  }
});
test('disconnection and idle timeout remain unknown without a retry', async () => {
  for (const settings of [{ checkRequests: [], disconnectPhase: 'normal' }, { checkRequests: [] }, { writeRequests: [], disconnectPhase: 'loader' }]) {
    const mock = mockUpdater(settings);
    await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'unknown' && ['disconnected', 'request_timeout'].includes(error.code));
    assert.equal(mock.sent.filter(packet => equalBytes(packet, upgradeCommand())).length, settings.writeRequests ? 2 : 1);
  }
});
test('delayed loader and reboot enumeration stay within explicit phase windows', async () => {
  const mock = mockUpdater({ loaderDelay: 12000, rebootDelay: 15000 });
  assert.equal((await runUpdate(mock.config, mock.options)).identity, 'FM-1_015');
  for (const [setting, code] of [[{ loaderDelay: 31000 }, 'loader_timeout'], [{ rebootDelay: 41000 }, 'reboot_timeout']]) {
    const delayed = mockUpdater(setting);
    await assert.rejects(runUpdate(delayed.config, delayed.options), error => error.state === 'unknown' && error.code === code);
  }
});
test('wrong loader model and post-reboot version never establish boot verification', async () => {
  for (const settings of [{ loaderIdentity: 'ota-Other_009' }, { bootIdentity: 'FM-1_014' }, { bootIdentity: 'Felucca_015' }]) {
    const mock = mockUpdater(settings);
    await assert.rejects(runUpdate(mock.config, mock.options), error => error.state === 'unknown' && !error.boot_identity_verified);
    assert.notEqual(mock.journal.record.state, 'succeeded');
    assert.equal(Boolean(mock.journal.record.transfer_finished), Boolean(settings.bootIdentity));
  }
});
test('explicit resume requires freshly identified loader, then only writes/reboots', async () => {
  const mock = mockUpdater({ resume: true });
  mock.config.expectedStockPair = { inputName: 'FM-1 Midi 1', outputName: 'FM-1 Midi 2' };
  const result = await runUpdate(mock.config, mock.options);
  assert.equal(result.boot_identity_verified, true);
  assert.equal(mock.sent.filter(packet => equalBytes(packet, upgradeCommand())).length, 1);
  assert.equal(mock.transitions.some(step => step.phase === 'checking'), false);
  const wrong = mockUpdater({ resume: true, loaderIdentity: 'FM-1_014' });
  await assert.rejects(runUpdate(wrong.config, wrong.options), error => error.code === 'resume_requires_loader' && error.state === 'unknown' && !error.destructive_started);
});
test('journal write failure before upgrade never sends it', async () => {
  const mock = mockUpdater(); mock.journal.transition = async () => { throw new Error('disk full'); };
  await assert.rejects(runUpdate(mock.config, mock.options), error => error.code === 'journal_write_failed');
  assert.equal(mock.sent.some(packet => equalBytes(packet, upgradeCommand())), false);
});
test('vendor timing defaults preserve required two and three second holds', () => {
  assert.equal(DEFAULT_TIMING.start, 2000); assert.equal(DEFAULT_TIMING.terminal, 3000);
  assert.equal(DEFAULT_TIMING.loader, 30000); assert.equal(DEFAULT_TIMING.reboot, 40000);
});
