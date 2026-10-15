"""Exact prior/candidate ELF rehearsal. Public Mainnet state; no RPC or live keys.

Signature verification is disabled to use the fixed public council identities.
Runtime signer privileges, PDA rules, program bytecode and Loader-v3 all execute.
"""
import argparse,base64,hashlib,json,struct
from pathlib import Path
from solders.account import Account
from solders.compute_budget import set_compute_unit_limit
from solders.instruction import Instruction,AccountMeta
from solders.litesvm import LiteSVM
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction
from solders.transaction_metadata import FailedTransactionMetadata

p=argparse.ArgumentParser();p.add_argument('prior',type=Path);p.add_argument('candidate',type=Path);p.add_argument('fixtures',type=Path);a=p.parse_args()
f=json.loads(a.fixtures.read_text());old=a.prior.read_bytes();new=a.candidate.read_bytes()
assert hashlib.sha256(old).hexdigest()=='ae89cbf030a30677c837a61634c969364882489837b4b91cdb9bc0cc21346eeb'
assert hashlib.sha256(new).hexdigest()==f['artifactSha256']
key=Pubkey.from_string;G=key(f['controller']);PD=key(f['programData']);CFG=key(f['config']);payer=key(f['payer']);treasury=key(f['treasury']);buffer=key(f['buffer']);LOADER=key('BPFLoaderUpgradeab1e11111111111111111111111');SYSTEM=Pubkey.default()
svm=LiteSVM().with_sigverify(False).with_transaction_history(0)
svm.add_program(G,old)
prior=f['prior']['value'];config_bytes=base64.b64decode(prior[2]['data'][0])
svm.set_account(payer,Account(10**11,b'',SYSTEM));svm.set_account(treasury,Account(10**10,b'',SYSTEM))
for seat in f['seats']:svm.set_account(key(seat),Account(10**7,b'',SYSTEM))
svm.set_account(CFG,Account(prior[2]['lamports'],config_bytes,G))
programdata=struct.pack('<IQB',3,0,1)+bytes(key(f['authority']))+old+bytes(f['capacity']-len(old))
svm.set_account(PD,Account(svm.minimum_balance_for_rent_exemption(len(programdata)),programdata,LOADER))
svm.set_account(G,Account(prior[0]['lamports'],struct.pack('<I',2)+bytes(PD),LOADER,True))
buf=struct.pack('<IB',1,1)+bytes(treasury)+new
svm.set_account(buffer,Account(svm.minimum_balance_for_rent_exemption(len(buf)),buf,LOADER))
def ix(w):return Instruction(key(w['program']),base64.b64decode(w['data']),[AccountMeta(key(k['key']),k['signer'],k['writable']) for k in w['keys']])
def send(w,ok=True):
    msg=Message.new_with_blockhash([set_compute_unit_limit(1400000),ix(w)],payer,svm.latest_blockhash())
    tx=Transaction.populate(msg,[Signature.default()]*msg.header.num_required_signatures)
    result=svm.send_transaction(tx)
    assert isinstance(result,FailedTransactionMetadata)!=ok,str(result)
    return result
def proposal(name):return svm.get_account(key(f[name]['proposal'])).data
def delay():return struct.unpack_from('<Q',svm.get_account(CFG).data,323)[0]
checks=[];u=f['upgrade'];t=f['policy'];fast=f['fast']
svm.warp_to_slot(1000)
# The old controller rejects a 150-slot policy even though the client accepts it.
bad=dict(t['create']);data=bytearray(base64.b64decode(bad['data']));data[1:9]=struct.pack('<Q',60);bad['data']=base64.b64encode(data).decode();bad['keys']=[dict(k) for k in bad['keys']];bad['keys'][3]['key']=u['proposal']
send(bad,False);assert svm.get_account(CFG).data==config_bytes
checks.append('deployed release 3 rejects the new 150-slot policy before upgrade')
send(u['create']);send(u['approvals'][0],False);send(u['seal'])
for proof in u['proofs']:send(proof)
send(u['approvals'][0]);send(u['approvals'][1]);svm.warp_to_slot(5500);send(u['execute'],False)
checks.append('all artifact proofs are required and two seats cannot install')
send(u['approvals'][2]);before_cfg=svm.get_account(CFG).data
result=send(u['execute']);installed=svm.get_account(PD).data
assert installed[45:45+len(new)]==new and not any(installed[45+len(new):]);assert installed[13:45]==bytes(key(f['authority']))
assert svm.get_account(CFG).data==before_cfg and delay()==4500
checks.append('actual old SBF and Loader install exact candidate while preserving authority and council bytes')
svm.warp_to_slot(5510);send(t['create'])
assert struct.unpack_from('<Q',proposal('policy'),75)[0]==4500
for approval in t['approvals']:send(approval)
send(t['execute'],False);svm.warp_to_slot(10009);send(t['execute'],False)
svm.warp_to_slot(10010);send(t['execute']);assert delay()==150
assert struct.unpack_from('<Q',svm.get_account(CFG).data,307)[0]==2
unchanged_before=bytearray(before_cfg);unchanged_after=bytearray(svm.get_account(CFG).data)
for start,end in [(307,315),(323,331),(339,347)]:
    unchanged_before[start:end]=bytes(end-start);unchanged_after[start:end]=bytes(end-start)
assert unchanged_before==unchanged_after
checks.append('policy update retains its 4500-slot snapshot and changes only delay and timing version')
svm.warp_to_slot(10020);send(fast['create']);send(fast['approvals'][0]);send(fast['approvals'][1]);svm.warp_to_slot(10170);send(fast['execute'],False)
send(fast['approvals'][2]);send(fast['execute']);assert proposal('fast')[352]==1
checks.append('new 150-slot proposal still requires three distinct council seats')
# Separate candidate-only run verifies the exact 149/150 boundary without rewinding the first VM.
svm2=LiteSVM().with_sigverify(False).with_transaction_history(0);svm2.add_program(G,new)
for k in [payer,treasury,CFG,*[key(s) for s in f['seats']]]:svm2.set_account(k,svm.get_account(k))
cfg=bytearray(svm2.get_account(CFG).data);cfg[307:315]=struct.pack('<Q',2);cfg[339:347]=struct.pack('<Q',62)
svm2.set_account(CFG,Account(prior[2]['lamports'],bytes(cfg),G));svm=svm2;svm.warp_to_slot(10020);send(fast['create'])
for approval in fast['approvals']:send(approval)
svm.warp_to_slot(10169);send(fast['execute'],False);svm.warp_to_slot(10170);send(fast['execute'])
checks.append('candidate rejects execution at 149 slots and executes at exactly 150 slots')
print(json.dumps({'artifactSha256':hashlib.sha256(new).hexdigest(),'artifactBytes':len(new),'passed':len(checks),'checks':checks,'actualSbfLifecyclePassed':True,'simulatorSigverify':False,'liveTransactions':0},indent=2))
