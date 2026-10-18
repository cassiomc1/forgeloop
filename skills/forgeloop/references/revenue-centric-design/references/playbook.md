# Focused journey playbook

Adapted with attribution to Richard ([@richardrx](https://x.com/richardrx)) and
[the pinned upstream curation](https://github.com/heliocosta-dev/revenue-centric-design/tree/1942760c2242f609bf63ce2c97204f5a1791bd68).
The complete [custom license](../LICENSE), including its no-gambling-use
restriction, applies. The prompts below are design hypotheses, not measured
results or universal benchmarks.

| Journey | Useful intervention | Observe | Guardrail | Read when needed |
| --- | --- | --- | --- | --- |
| Landing page | Describe the actual audience, problem, delivered outcome and next step; show available product proof | Can a new visitor explain the offer and begin the intended task? | No invented claims, testimonials or customer logos | [Conversion](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/conversion-and-landing-pages.md) |
| Signup and checkout | Request information when needed and show total cost before commitment | Task completion, field errors and abandonment at a specific step | No hidden fees or unconsented paid choices; preserve security checks | [Forms](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/checkout-and-forms.md) |
| First use | Make the first real value event obvious; provide a useful empty state and recoverable errors | Time to the first successful value event | No fake success, mandatory unrelated setup or premature upgrade interruption | [Activation](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/onboarding-and-activation.md) |
| Pricing and limits | Explain who a plan serves, actual limits, billing cadence and upgrade consequences | Understanding of the choice and successful intended purchase | Total price, renewals and trial conditions stay explicit | [Pricing](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/pricing-and-monetization.md) |
| Retention and cancellation | Fix mismatches between promised and delivered value; offer relevant alternatives while preserving an easy exit | Repeated value events, cancellation reasons and support burden | Successful cancellation and opt-out remain first-class outcomes | [Retention](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/churn-and-retention.md) |
| Dashboard | Put the user's next decision beside understandable evidence and explicit freshness | Can the user interpret the state and take the next useful action? | Missing or stale data must remain visible; color is not the only signal | [Dashboards](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/dashboards-and-data-viz.md) |
| Feature scope | Prefer the smallest feature that resolves observed user friction | Adoption and completion of the value event | Avoid increasing setup cost or hiding existing core functionality | [Product strategy](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/product-strategy-and-features.md) |
| Positioning | Use confirmed customer needs and demonstrated differentiation | Whether the intended audience understands the offer | An assumption is labeled until validated | [Positioning](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/positioning-icp-and-gtm.md) |
| Experiment | Define the value event, hypothesis, comparison and stopping rule before measurement | Sample size, uncertainty and guardrail outcomes | Do not stop opportunistically or infer business lift from a UI test | [Measurement](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/metrics-and-experimentation.md) |

For cross-cutting rationale, read the pinned [design method](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/revenue-centric-design.md),
[behavioral toolkit](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/behavioral-science-toolkit.md)
or [differentiation discussion](https://github.com/heliocosta-dev/revenue-centric-design/blob/1942760c2242f609bf63ce2c97204f5a1791bd68/references/ai-era-differentiation.md)
only when relevant. These are external references; offline use remains possible
with this local playbook. A reference link does not authorize scraping X or
running upstream updater scripts.

## ForgeLoop and ForgeLoopAudit example

For a new auditor opening a project, define the value event as a successful
read-only inspection with a comprehensible finding and canonical next action.
Review project selection, empty/error states, evidence freshness and navigation.
Measure task success and time-to-understanding in a user study if available.
A successful browser test demonstrates that the journey works; it does not
prove activation, retention or revenue lift. Preserve read-only authority,
source identity, accessibility and every integrity warning.
