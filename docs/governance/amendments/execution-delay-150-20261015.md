# 150-slot council execution delay

The user authorized production GitHub publication and Mainnet installation of
the 150-slot governance execution delay on October 15, 2026, including KMS
treasury funding and three council signatures. This supersedes the older
4,500-slot minimum for V3. Review and expiry windows, quorum, account layouts,
artifact verification, target gates, and authority remain unchanged.

Controller release 4 is based on deployed release 3, source
`3702352854404d7907cc97037cb64bc36b1f3af0`, preserving its target-retirement
operations. The Rust minimum/default and TypeScript validation/default become
150 slots. Existing proposals keep their original timing snapshots. Slot counts
are authoritative; 150 slots is nominally one minute at 400 ms per slot.

Installation and policy activation are distinct: the release-3 controller must
first approve and execute the exact release-4 artifact under the existing
4,500-slot policy. Then a separate council `setTiming` proposal changes only
`delaySlots` to 150. That proposal also retains its initial 4,500-slot wait.
The following proposals use 150 slots. No new business program is deployed.
