import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as wire from '../protocol.mjs';
import { crc16 } from '../policy.mjs';
const hex=b=>Buffer.from(b).toString('hex');
test('closed WL82 byte vectors use exact lengths addresses endianness and CRC',()=>{
 assert.equal(crc16(Buffer.from('123456789')),0x31c3);
 assert.equal(hex(wire.inquiryCommand().cdb),'120000002400');assert.equal(wire.inquiryCommand().dataInLength,36);
 assert.equal(hex(wire.statusCommand().cdb),'fc03'+'ff'.repeat(14));assert.equal(hex(wire.onlineCommand().cdb),'fc0a'+'ff'.repeat(14));
 assert.equal(hex(wire.readCommand(0x12300).cdb),'fd05000123000100'+'ff'.repeat(8));assert.equal(wire.readCommand(0).dataInLength,256);
 assert.equal(hex(wire.eraseCommand(0x92000).cdb),'fb0100092000'+'ff'.repeat(10));
 const page=Uint8Array.from({length:256},(_,i)=>i),program=wire.programCommand(0x92000,page);assert.equal(crc16(page),0x7e55);
 assert.equal(hex(program.cdb),'fb0400092000010000557e'+'ff'.repeat(5));assert.deepEqual(program.dataOut,page);assert.equal(program.dataInLength,0);page[0]=0xff;assert.equal(program.dataOut[0],0);
 assert.equal(hex(wire.helperJumpCommand().cdb),'fb0801c020000001'+'ff'.repeat(8));assert.equal(hex(wire.resetCommand().cdb),'fc0c00000001'+'ff'.repeat(10));
});
test('no general memory chip erase or out-of-scope flash builder is exposed',()=>{
 for(const address of [-1,0.5,0x3fff,0x93000,0x100000,NaN])assert.throws(()=>wire.eraseCommand(address));
 for(const address of [-1,1,0x3f00,0x93000,0xffffffff])assert.throws(()=>wire.programCommand(address,new Uint8Array(256)));
 for(const size of [0,255,257])assert.throws(()=>wire.programCommand(0x4000,new Uint8Array(size)));
 for(const [address,length] of [[1,256],[-1,256],[0x100000,256],[0,512],[0,1]])assert.throws(()=>wire.readCommand(address,length));
 for(const name of ['command','memWrite','memoryRead','chipErase','readKey'])assert.equal(Object.hasOwn(wire,name),false);
 assert.throws(()=>wire.validateHelper(new Uint8Array(24064)));
});
test('inquiry and fixed loader responses require complete echoed identity and exact flash tuple',()=>{
 const inquiry=new Uint8Array(36).fill(32);inquiry.set(Buffer.from('WL82'),8);inquiry.set(Buffer.from('UBOOT1.00'),16);inquiry.set(Buffer.from('1.00'),32);assert.equal(wire.checkedInquiry(inquiry),true);
 assert.throws(()=>wire.checkedInquiry(inquiry.subarray(0,35)));const high=inquiry.slice();high[8]|=0x80;assert.throws(()=>wire.checkedInquiry(high));inquiry[8]=0;assert.throws(()=>wire.checkedInquiry(inquiry));
 const online=new Uint8Array(16);online.set([0xfc,0x0a,3,0,0x14,0x60,0x85,0]);assert.equal(wire.checkedReply(0xfc0a,online)[0],3);
 for(const at of [0,1,2,4,5,6]){const changed=online.slice();changed[at]^=1;assert.throws(()=>wire.checkedReply(0xfc0a,changed));}
 assert.throws(()=>wire.checkedReply(0xfc0a,online.subarray(0,15)));assert.throws(()=>wire.checkedReply(0xfc09,online));
 const erase=new Uint8Array(16);erase.set([0xfb,1]);assert.equal(wire.checkedReply(0xfb01,erase)[0],0);erase[2]=1;assert.throws(()=>wire.checkedReply(0xfb01,erase));
});
test('only exact pinned already-encoded helper produces 47 complete bounded RAM chunks',{skip:!process.env.FM1_WL82_HELPER},async()=>{
 const helper=await fs.readFile(process.env.FM1_WL82_HELPER);assert.equal(wire.validateHelper(helper),true);const rebuilt=[];
 for(let i=0;i<47;i++){const op=wire.helperChunkCommand(helper,i),v=new DataView(op.cdb.buffer);assert.equal(v.getUint16(0,false),0xfb06);assert.equal(v.getUint32(2,false),wire.HELPER_ADDRESS+i*512);assert.equal(v.getUint16(6,false),512);assert.equal(op.dataOut.length,512);assert.equal(v.getUint16(9,true),crc16(op.dataOut));rebuilt.push(op.dataOut);}
 assert.deepEqual(Buffer.concat(rebuilt),helper);assert.throws(()=>wire.helperChunkCommand(helper,47));assert.throws(()=>wire.helperChunkCommand(helper,-1));const changed=helper.slice();changed[0]^=1;assert.throws(()=>wire.helperChunkCommand(changed,0));
});
