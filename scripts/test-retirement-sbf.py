"""Run the final controller ELF and real Loader-v3 in LiteSVM.

Copies public Mainnet account bytes into an isolated simulator. Signature
verification is disabled only to exercise fixed KMS public keys locally;
runtime signer, ownership, PDA and Loader checks remain active. No live RPC.
"""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path
from solders.account import Account
from solders.compute_budget import set_compute_unit_limit
from solders.instruction import Instruction, AccountMeta
from solders.keypair import Keypair
from solders.litesvm import LiteSVM
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction
from solders.transaction_metadata import FailedTransactionMetadata

G = Pubkey.from_string('8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx')
T = Pubkey.from_string('2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw')
TREASURY = Pubkey.from_string('8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j')
LOADER = Pubkey.from_string('BPFLoaderUpgradeab1e11111111111111111111111')
IXS = Pubkey.from_string('Sysvar1nstructions1111111111111111111111111')
DOMAIN = b'ameba-governance-v3'
SYSTEM = Pubkey.default()

def pda(*seeds): return Pubkey.find_program_address(seeds, G)[0]
CFG = pda(DOMAIN, b'council')
GATE = pda(DOMAIN, b'gate', bytes(T))
AUTH = pda(DOMAIN, b'target-authority', bytes(T))
PD = Pubkey.find_program_address([bytes(T)], LOADER)[0]
def meta(key, write=False, sign=False): return AccountMeta(key, sign, write)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('elf', type=Path)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('target_elf', type=Path)
    parser.add_argument('--verification-snapshot', type=Path)
    parser.add_argument('--verification-elf', type=Path)
    args = parser.parse_args()
    elf = args.elf.read_bytes()
    target_elf = args.target_elf.read_bytes()
    initial = json.loads(args.snapshot.read_text())['accounts']
    config_bytes = base64.b64decode(initial[str(CFG)]['data'][0])
    seat_keys = [Pubkey.from_bytes(config_bytes[139+32*i:171+32*i]) for i in range(3)]
    pid = int.from_bytes(config_bytes[339:347], 'little')
    proposal_key = pda(DOMAIN, b'proposal', struct.pack('<Q', pid))
    gate_bytes = bytearray(base64.b64decode(initial[str(GATE)]['data'][0]))
    gate_bytes[11] = 2
    gate_bytes[108:116] = struct.pack('<Q', 44)
    gate_bytes[148:156] = struct.pack('<Q', 400)
    gate_bytes[156:158] = struct.pack('<H', 2)
    target_payload = target_elf + bytes(1_971_272-len(target_elf))
    target_pd = struct.pack('<IQB', 3, 400, 1) + bytes(AUTH) + target_payload
    payload_hash = hashlib.sha256(target_payload).digest()
    receipt_hash = hashlib.sha256(b'local exact recovery inventory receipt').digest()
    checks = []

    def setup(override=None):
        svm = LiteSVM().with_sigverify(False).with_transaction_history(0)
        svm.add_program(G, elf)
        payer = Keypair().pubkey()
        svm.set_account(payer, Account(10**10, b'', SYSTEM))
        svm.set_account(TREASURY, Account(10**9, b'', SYSTEM))
        for seat in seat_keys: svm.set_account(seat, Account(1_000_000, b'', SYSTEM))
        svm.set_account(CFG, Account(initial[str(CFG)]['lamports'], config_bytes, G))
        svm.set_account(GATE, Account(initial[str(GATE)]['lamports'], bytes(gate_bytes), G))
        svm.set_account(PD, Account(10_014_940_600, target_pd, LOADER))
        svm.set_account(T, Account(833120, struct.pack('<I',2)+bytes(PD), LOADER, True))
        svm.warp_to_slot(1000)
        policy = {'target':T,'epoch':44,'slot':400,'payload':payload_hash,'receipt':receipt_hash}
        policy.update(override or {})
        body = bytes(policy['target']) + struct.pack('<QQ',policy['epoch'],policy['slot']) + policy['payload'] + policy['receipt']
        action = b'\x07' + body + bytes(192-len(body))
        ix = Instruction(G, b'\x01'+struct.pack('<Q',pid)+action, [meta(payer,True,True),meta(seat_keys[0],sign=True),meta(CFG,True),meta(proposal_key,True),meta(SYSTEM)])
        send(svm,payer,ix)
        digest = svm.get_account(proposal_key).data[316:348]
        return svm,payer,digest

    def send(svm,payer,ix,success=True):
        message = Message.new_with_blockhash([set_compute_unit_limit(1_400_000),ix],payer,svm.latest_blockhash())
        tx = Transaction.populate(message,[Signature.default()]*message.header.num_required_signatures)
        result = svm.send_transaction(tx)
        assert isinstance(result, FailedTransactionMetadata) != success, str(result)
        return result

    def approve(svm,payer,digest,index,success=True):
        send(svm,payer,Instruction(G,b'\x04'+digest,[meta(CFG),meta(proposal_key,True),meta(seat_keys[index],sign=True)]),success)

    def retire(digest,treasury=TREASURY,authority=AUTH,target=T,pd=PD):
        return Instruction(G,b'\x11'+digest,[meta(CFG),meta(proposal_key,True),meta(target,True),meta(pd,True),meta(GATE,True),meta(treasury,True),meta(authority),meta(LOADER),meta(IXS)])

    def ready(override=None):
        svm,payer,digest=setup(override)
        for i in range(3):approve(svm,payer,digest,i)
        svm.warp_to_slot(5501)
        return svm,payer,digest

    svm,payer,digest=setup()
    send(svm,payer,retire(digest),False)
    approve(svm,payer,digest,0);approve(svm,payer,digest,1)
    svm.warp_to_slot(5501);send(svm,payer,retire(digest),False)
    approve(svm,payer,digest,1,False)
    checks.append('no quorum and duplicate approvals cannot close ProgramData')

    svm,payer,digest=setup()
    for i in range(3):approve(svm,payer,digest,i)
    send(svm,payer,retire(digest),False)
    assert svm.get_account(PD).lamports==10_014_940_600
    checks.append('three approvals still require the unchanged 4500-slot delay')

    for label,override in [('payload',{'payload':bytes([9])*32}),('epoch',{'epoch':43}),('deployment',{'slot':399}),('target',{'target':Pubkey.new_unique()})]:
        svm,payer,digest=ready(override);send(svm,payer,retire(digest),False)
        assert svm.get_account(PD).data==target_pd
        checks.append('rejects wrong '+label+' commitment without changing ProgramData')

    svm,payer,digest=ready()
    before=svm.get_balance(TREASURY)
    send(svm,payer,retire(digest,treasury=payer),False)
    send(svm,payer,retire(digest,authority=Pubkey.new_unique()),False)
    active=bytearray(svm.get_account(GATE).data);active[11]=0;active[148:158]=bytes(10)
    svm.set_account(GATE,Account(initial[str(GATE)]['lamports'],bytes(active),G))
    send(svm,payer,retire(digest),False)
    checks.append('rejects alternate refund recipient, wrong PDA and active target')

    svm,payer,digest=ready()
    before=svm.get_balance(TREASURY)
    send(svm,payer,retire(digest))
    assert svm.get_account(PD) is None or svm.get_balance(PD)==0
    assert svm.get_balance(TREASURY)==before+10_014_940_600
    assert svm.get_account(proposal_key).data[352]==1
    assert svm.get_account(GATE).data[11]==2
    assert int.from_bytes(svm.get_account(GATE).data[108:116],'little')==45
    tombstone=svm.get_account(T)
    assert tombstone.lamports==833120 and tombstone.data==struct.pack('<I',2)+bytes(PD)
    send(svm,payer,retire(digest),False)
    checks.append('actual SBF and Loader close return every ProgramData lamport, retain tombstone, prevent replay')

    def reclaim(records):
        return Instruction(G,b'\x12'+bytes(T),[meta(CFG),meta(T),meta(PD),meta(TREASURY,True),*[meta(k,True) for k in records]])
    before=svm.get_balance(TREASURY)
    expected=svm.get_balance(GATE)+svm.get_balance(proposal_key)
    send(svm,payer,reclaim([GATE,CFG]),False)
    send(svm,payer,reclaim([GATE,proposal_key]))
    assert svm.get_balance(TREASURY)==before+expected
    assert all(svm.get_account(k) is None or (svm.get_balance(k)==0 and svm.get_account(k).data==b'' and svm.get_account(k).owner==SYSTEM) for k in [GATE,proposal_key])
    assert svm.get_account(CFG).data[:339]==config_bytes[:339]
    checks.append('reclaims target records only, rejects config, preserves council and timing')

    svm,payer,digest=ready()
    send(svm,payer,reclaim([GATE,proposal_key]),False)
    checks.append('live ProgramData prevents premature record reclamation')
    if args.verification_snapshot:
        verification = json.loads(args.verification_snapshot.read_text())
        verifier = Pubkey.from_string(verification['program'])
        metadata = Pubkey.from_string(verification['metadata'])
        copied = verification['accounts'][str(metadata)]
        verifier_elf = args.verification_elf.read_bytes()
        assert hashlib.sha256(verifier_elf).hexdigest() == verification['artifactSha256']

        def verification_ix(recipient=TREASURY, auth=AUTH, record=metadata):
            return Instruction(G,b'\x13'+bytes(T),[
                meta(CFG),meta(T),meta(PD),meta(recipient,True),meta(auth,True),
                meta(record,True),meta(verifier),meta(SYSTEM)])

        svm,payer,digest=ready()
        svm.add_program(verifier,verifier_elf)
        svm.set_account(metadata,Account(copied['lamports'],base64.b64decode(copied['data'][0]),verifier))
        svm.set_account(AUTH,Account(50_000,b'',SYSTEM))
        send(svm,payer,verification_ix(),False)
        assert svm.get_balance(metadata)==copied['lamports']
        checks.append('live ProgramData prevents verification record closure')
        send(svm,payer,retire(digest))
        send(svm,payer,verification_ix(recipient=payer),False)
        send(svm,payer,verification_ix(auth=Pubkey.new_unique()),False)
        send(svm,payer,verification_ix(record=Pubkey.new_unique()),False)
        checks.append('verification cleanup rejects another recipient, authority and metadata')
        before=svm.get_balance(TREASURY)
        send(svm,payer,verification_ix())
        assert svm.get_balance(TREASURY)==before+copied['lamports']+50_000
        assert all(svm.get_account(k) is None or svm.get_balance(k)==0 for k in [metadata,AUTH])
        send(svm,payer,verification_ix(),False)
        checks.append('deployed Otter ELF closes canonical metadata and refunds all rent and PDA balance without replay')
    print(json.dumps({'artifactBytes':len(elf),'artifactSha256':hashlib.sha256(elf).hexdigest(),'passed':len(checks),'checks':checks,'simulatorSigverify':False,'liveTransactions':0},indent=2))

if __name__=='__main__':main()
