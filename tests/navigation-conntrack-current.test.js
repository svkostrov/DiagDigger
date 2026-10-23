import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseConntrack, parseDiagnostic } from '../parser.js';

test('conntrack: original/reply, IPv6, ICMP, flags and unknown lines', () => {
  const {sessions,unparsed}=parseConntrack(`<conntrack><ipv4><![CDATA[
TCP 6 120 ESTABLISHED src=192.0.2.2 dst=198.51.100.9 sport=4000 dport=443 packets=10 bytes=1000 src=198.51.100.9 dst=203.0.113.1 sport=443 dport=5000 packets=8 bytes=900 [ASSURED] [FASTNAT]
ICMP 1 src=192.0.2.3 dst=198.51.100.1 type=8 code=0 id=12 packets=1 bytes=84 src=198.51.100.1 dst=192.0.2.3 type=0 code=0 id=12 packets=0 bytes=0 [UNREPLIED]
UDP 17 src=[2001:db8::1] dst=[2001:db8::2] sport=5353 dport=5353 packets=1 bytes=80 src=[2001:db8::2] dst=[2001:db8::1] sport=5353 dport=5353 packets=0 bytes=0 [UNREPLIED]
unknown format
]]></ipv4></conntrack>`);
  assert.equal(sessions.length,3);assert.equal(unparsed.length,1);
  assert.equal(sessions[0].original.sport,'4000');assert.equal(sessions[0].reply.dport,'5000');
  assert.equal(sessions[0].tcpState,'ESTABLISHED');assert.deepEqual(sessions[0].flags,['ASSURED','FASTNAT']);
  assert.equal(sessions[1].original.type,'8');assert.equal(sessions[1].tcpState,'');
  assert.equal(sessions[2].original.src,'2001:db8::1');
  assert.deepEqual(parseConntrack('<conntrack><ipv6/></conntrack>'),{sessions:[],unparsed:[]});
});

test('conntrack presentations are exact; lockout is not a sessions table', () => {
  const d=parseDiagnostic('test.txt', '<file name="ndm:sharing-config">hostname test</file><!-- show ip conntrack --><conntrack><ipv4/></conntrack><!-- show ip conntrack lockout --><enabled>yes</enabled><!-- show ipv6 conntrack --><conntrack><ipv6/></conntrack></selftest>');
  assert.equal(d.sections.filter(s=>s.presentation==='conntrack').length,2);
  assert.notEqual(d.sections.find(s=>s.name==='show ip conntrack lockout').presentation,'conntrack');
});

test('all local real conntrack lines are parsed without losing sessions', () => {
  for(const name of fs.readdirSync(new URL('./fixtures/',import.meta.url))) {
    if(!name.endsWith('.txt')) continue;
    const text=fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
    const d=parseDiagnostic(name,text);
    for(const s of d.sections.filter(s=>s.presentation==='conntrack')) {
      const result=parseConntrack(s.content);
      const expected=[...s.content.matchAll(/^\s*\w+\s+\d+\s+.*\bsrc=/gm)].length;
      assert.equal(result.sessions.length,expected,`${name}: ${s.name}`);
      assert.equal(result.unparsed.length,0,`${name}: unknown lines`);
    }
  }
});
