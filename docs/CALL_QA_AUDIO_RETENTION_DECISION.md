# Call QA audio retention decision

Status: decision record only. PR 3 stores no audio and adds no recording path.

Audio could help resolve disputes where the server transcript omitted or
misheard important wording. That benefit is not enough to justify recording
without an approved privacy and operational policy.

Management/privacy approval must decide:

- employee notice and consent
- whether callers or employees may accidentally speak real patient information
- who may access recordings and for what purpose
- encryption in transit and at rest
- retention period and automatic expiry
- documented deletion and legal-hold procedure
- audit logging and access review
- storage and review cost
- whether recordings may be downloaded or exported
- incident response for accidental sensitive content

A lower-retention alternative is a temporary second transcription stream used
only to compare disputed words, with audio discarded immediately and never
stored. That alternative still needs consent, access controls, and a documented
privacy review.

Recommendation: no Call QA audio recording or retention should ship without
explicit management and privacy approval. Until then, calibration uses sanitized
text fixtures only.
