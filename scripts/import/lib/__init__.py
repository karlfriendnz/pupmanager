"""
The reusable half of the client-data import toolkit.

    text        normalisation and "do these two values agree?"
    classify    what a cell IS, decided by content and never by position
    notes       the multi-line notes blob, parsed into structured facts
    dedup       identity, placeholder addresses, junk-value filters
    parsing     the façade: one import for all of the above
    people      the person registry, field precedence, dog merging
    courses     the class catalogue: match, invent, enrol
    dogs        the dog-name judge
    config      per-client vocabulary, loaded from JSON
    merge       the engine that turns file fragments into one plan
    plan_schema the plan's shape, written down, plus a validator
    render      xlsx / HTML / CSV output

NOTHING IN HERE TOUCHES A DATABASE OR THE NETWORK, on purpose. This half reads
files and writes files. The load half is a separate script that reads the plan
this one produces — which is what makes an import reviewable before it is
irreversible.
"""
