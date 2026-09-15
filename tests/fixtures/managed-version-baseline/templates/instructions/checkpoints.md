{{#if has_checkpoints}}## Checkpoints

A checkpoint asks you to judge a specific question about the change. `discern_status` and `discern_prepare` identify relevant checkpoints; `discern_done` supplies any question that needs a recorded answer.

Judge the question against the actual change and record your conclusion using the supplied instructions. If it does not hold, explain the tradeoff for the owner without including secrets. The gate can still run, but landing requires the owner to approve an exception for the exact unmet questions. Recorded landing grants do not authorize that exception.{{/if}}
