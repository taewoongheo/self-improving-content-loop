# Imagery

## Scope, inputs, and outputs

This file owns the current account-wide rules for translating approved content meaning into imagery for LIFT CODE: semantic visualization, art direction, cross-image variation, within-image composition, runtime request constraints, and generation/selection policy.

- The selected message owns persuasion strategy and claim limits.
- The approved copy owns the actual hook, body, CTA, title, caption, and all language.
- `context/expertise.md` owns reusable strength-training domain knowledge and provenance, not visual instructions.
- The content project owns image-layer presence, fixed assets, placement, dimensions, crop behavior, and all content-specific layout decisions except the account-wide slideshow badge specified below.
- Raw reference assets remain evidence in their designated owner. This file owns only the current account-wide visual interpretation derived from product and brand direction.
- The selected format's `imagery.md` owns reusable visual interpretation specific to that format's designated references; this file does not restate or override it.
- The editable project materializes the DB-owned approved copy and owns the final image bytes and content-specific image geometry used for one content.

At generation time, read the approved project copy, selected image geometry, this file, and the selected format's `imagery.md` when present, then construct the provider request as a transient execution value. Do not persist that request as a separate artifact. Do not store post-specific copy, duplicate layout values, final images, or object-specific default scenes here.

User-directed account-wide improvements update this file immediately. Format-specific visual corrections update only that format's `imagery.md`. Imagery is not a hypothesis axis.

## Persistent slideshow badge

Every audience-facing slideshow page carries one fixed `LIFT CODE` identity badge in the lower-left corner. This is persistent account identification, not a CTA or a product-capability claim.

- Canvas contract: `1080 × 1350`.
- Position: `x: 70`, `y: 1240` on every page.
- Text: `LIFT CODE`, Inter, `18px`, weight `800`, `2.2px` letter spacing, white, optically centered `1px` below the geometric center.
- Pill: `168 × 42`, near-black `#171715`, radius `21`.
- The slideshow renderer injects this badge above project layers in both editor previews and exports. Projects do not duplicate it as an editable layer.
- For another canvas width, scale the badge and its `70px` left and `68px` bottom offsets by `canvas width / 1080`.
- Keep the badge above imagery and backgrounds, never change its wording, color, scale, or position per slide, and reserve its lower-left area when composing content.
- Do not add any second logo, URL, product message, CTA, or branded footer.

## Semantic translation

For each generated image layer selected for the content project, derive one visual scene from the approved meaning of that slide.

- Let copy make the argument. Let the image embody the physical stake: load, effort, uncertainty, discipline, accumulated work, or controlled aggression.
- Extract the reader-facing situation, consequence, or action rather than illustrating the sentence word for word.
- Show one dominant idea per image. Do not combine every exercise, input, or method from the slide into one scene.
- Keep all necessary argumentative meaning in copy; the image must not introduce an unsupported performance or physique claim.
- Prefer moments around real strength training: preparing a bar, gripping equipment, bracing before a Set, logging a completed Set, resting under visible effort, or moving through a credible Gym environment.
- Use bodies as evidence of effort and physical ambition, not as fabricated before/after proof or a promise that LIFT CODE produced the physique.
- Preserve product imagery intentionally selected as a fixed layer in the content project.

## Art direction and cross-image variation

The account-wide visual identity is `restrained wildness`: masculine physical force contained by deliberate training structure.

- When compatible with the selected format's designated evidence, favor dark, high-contrast, near-black environments with controlled highlights, steel, rubber, chalk, worn leather, sweat, and believable Gym texture. When the evidence depends on ordinary mixed capture conditions, preserve its heterogeneity while retaining the same physical stakes and restraint.
- Use one restrained signal color when useful; do not flood the image with multiple neon accents.
- Make strength feel heavy and immediate through loaded equipment, close physical detail, compressed space, and purposeful posture.
- Make control feel visible through clean framing, stable geometry, ordered equipment, repeated Set structure, measured preparation, and the absence of chaotic spectacle.
- Prefer grounded realism over glossy supplement advertising, superhero fantasy, luxury fitness campaigns, or generic motivational poster polish.
- When people are present, prioritize adult male lifters consistent with the primary audience unless approved meaning requires otherwise. Show unposed concentration, strain, preparation, or recovery rather than performative flexing for the camera.
- Do not require a face. Hands, forearms, back, torso, stance, equipment contact, and partial body crops can carry masculine physicality without turning every slide into a portrait.
- Vary the primary carrier across a slideshow when the selected format's evidence permits it: person, loaded implement, plates and increments, training log, machine stack, empty rack after effort, or another copy-relevant scene.
- Vary camera distance and angle across adjacent slides unless the selected format's evidence depends on a coherent capture baseline. Even then, vary the content-specific action, framing, or background detail rather than repeating one exact composition. Maintain account identity through physical stakes and restraint rather than forcing identical lighting, palette, surface treatment, or camera polish across unrelated source moments.
- Do not repeat one lifter, one rack, one object cluster, or one exact composition merely to manufacture consistency.

Before provider requests, assign each generated slot distinct copy-relevant scene content. Vary the primary carrier, Gym setting, camera distance or angle, and dominant light treatment only within the selected format's reference-derived envelope.

## Within-image composition

- Read the selected image layer's aspect ratio, placement, dimensions, and crop behavior; do not restate or own those layout values here.
- Compose for the final crop, with the decisive action or equipment detail inside the content-specific safe region.
- Protect copy space through simple local backgrounds and controlled negative space rather than empty studio backdrops.
- Keep the primary physical action immediately legible at slideshow size.
- Use one plausible Gym environment and only the elements needed to communicate the moment.
- Do not place essential anatomy, hands, plates, pin settings, or bar contact at crop edges.
- Establish the camera holder and capture reason before composing a candid scene. Every visible hand and concurrent action must remain physically compatible with that capture setup; a self-shot must not imply that the camera holder is simultaneously using both hands for a lift, handling a heavy plate, or performing another incompatible task.
- A companion-shot training image must read as an openly shared moment: place the camera within the same station at normal friend or training-partner distance with a clear line of sight. Do not hide the camera behind rack uprights, machines, doors, or narrow gaps in a way that makes the image feel covert or voyeuristic.
- Use behavior that would be ordinary in the depicted Gym context. Do not stage an uncommon action merely to literalize the copy when a familiar contemporary behavior, equipment state, environment, or indirect physical cue can carry the same meaning.

## Runtime request constraints

Construct one provider request from approved meaning, art direction, composition, and the following exclusions. Use a plain semantic scene description instead of copying approved slide wording when possible.

When designated references establish a photographic format and the configured tool accepts reference images, condition generation on up to three representative reference images. Use them only for medium, capture character, subject scale, framing, exposure, environmental imperfection, and image-copy spacing. Explicitly require a new adult identity, new pose, and new scene; do not reproduce embedded text, platform chrome, branding, or a source photograph's distinctive composition.

For candid social photography, avoid generic realism intensifiers such as `photorealistic`, `hyperreal`, `cinematic`, `ultra-detailed`, and `dramatic lighting`. Describe an ordinary capture process instead: handheld phone-camera auto-exposure, mixed practical Gym lighting, limited dynamic range, slight focus or motion imperfection where plausible, natural sensor noise, unretouched skin, ordinary clothing folds, incidental background clutter, and an imperfect but legible crop. Do not add all imperfections mechanically to every image; preserve only those that fit the reference evidence and scene.

Encode these constraints:

- no readable captions, labels, logos, watermarks, or unapproved brand marks;
- no fake LIFT CODE interface or unapproved product UI;
- no visual claim that LIFT CODE already exists, has users, or produced a depicted result;
- no fabricated before/after transformation;
- no copied reference subject, composition, signature, or distinctive expression;
- no collage, split screen, or multiple competing scenes unless explicitly required by approved content and layout;
- no glossy stock-fitness advertising, supplement-ad aesthetic, stage lighting, or showroom perfection;
- no cartoonish aggression, roaring stereotype, weapon imagery, violence, domination of another person, or sexualized humiliation;
- no hacker, terminal, source-code, cyberpunk, or Matrix imagery used to literalize `CODE`;
- no impossible plates, malformed barbell, broken cable path, unusable machine geometry, unsafe rack setup, or obvious anatomy defect;
- no synthetic plastic skin, excessive sharpening, implausible symmetry, impossible lighting, or over-rendered muscle detail.

These exclusions guide provider requests and candidate selection. They do not authorize generation beyond the bounded candidate and attempt totals below.

## Generation and selection policy

- Execution surface: the currently configured Hermes image-generation tool.
- Backend, provider, model, and credential resolution belong to the active Hermes tool/profile configuration and are not duplicated here.
- If the active tool does not expose a request parameter, do not pretend this file can select it.
- For photographic formats calibrated from designated references, the required technically usable candidate set per eligible slot is exactly `3`, whether or not the active tool can accept reference-image inputs.
- For other generated imagery, the required technically usable candidate set per eligible slot is exactly `1` unless a user explicitly changes the project scope.
- Select exactly one final candidate per slot through the bounded photographic-authenticity gate below. Do not generate additional candidates merely because none is aesthetically ideal after the required candidate set succeeds.
- Maximum assistant-level generation calls for a three-candidate slot: `6`; stop once three technically usable candidates exist.
- Maximum assistant-level generation calls for a one-candidate slot: `4`; stop once one technically usable candidate exists.
- Every assistant-level call consumes the slot's call budget. Provider-internal retries, transport handling, response decoding, and file storage belong to the active Hermes image tool and are not redefined here.
- Final embedded format: PNG.
- Source aspect ratio or size: choose one supported option after content-specific image geometry is selected.
- Embed the selected provider PNG bytes as returned. Do not resize, downscale, recompress, or convert generated imagery merely to reduce Project JSON or storage size.

### Photographic-authenticity gate

After the complete required candidate set exists, evaluate every candidate against the hard gates below. Discard every candidate that fails any hard gate, then retain the passing candidate closest to the designated reference family's capture character and subject scale; use generation order only to break an otherwise equal choice.

1. **Hard validity:** decodable provider PNG, correct usable dimensions, no readable generated text, logo, watermark, copied interface, or copied source identity.
2. **Human and equipment plausibility:** no malformed hands, fused contact points, impossible anatomy, implausible muscle insertions, broken barbell/rack/machine geometry, unsafe physical relationship, or action that cannot be performed with the hands available under the stated camera setup.
3. **Capture plausibility:** a credible camera holder and reason for the picture; context-normal subject behavior; an open participant viewpoint rather than covert observation when another person holds the camera; no synthetic plastic skin, uniformly painted sweat, excessive micro-contrast, impossible depth of field, contradictory light directions, implausibly clean edge separation, or showroom-perfect environment that conflicts with the reference.
4. **Reference fit:** correct selected subject and media class, behavior and capture character consistent with the designated evidence, suitable copy space, and no repeated face, object cluster, environment, or exact composition carried across adjacent slides without evidence.

If the call budget ends before the required technically usable candidate set exists, or if no candidate in the complete set passes every hard gate, the slot is blocked: embed nothing, do not extend the budget, and report the smallest missing asset or user action needed to continue. A technically usable candidate counts toward the required set even when it later fails a hard gate.

Record no separate ranking artifact. Candidate files and transient contact sheets are execution intermediates; after the final project renders and verifies, remove unselected candidates unless another retained project references them.

## Rationale

LIFT CODE must attract men through physical ambition and controlled aggression while earning recommendation trust through precision, restraint, and visible training reality. The imagery therefore cannot be only feral, only clinical, or only motivational. It should make force feel real and system feel necessary without pretending an unbuilt product has already produced results.