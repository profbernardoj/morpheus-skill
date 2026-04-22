# PLAYBOOK.md — Decision Frameworks

*Standard approaches for recurring decisions. When facing a choice, check here first.*

---

## Strategy Frameworks

### Technology Adoption Decision Tree

```
Is it open source?
├─ Yes → Can I fork it if things go wrong?
│   ├─ Yes → Low risk, proceed
│   └─ No → Medium risk, document dependencies
└─ No → Is there an open alternative?
    ├─ Yes → Prefer open
    └─ No → High risk, plan exit strategy before adopting
```

### Investment/Partnership Decision Framework

1. **Alignment check:** Does this advance family, faith, or freedom goals?
2. **Decentralization check:** Does it reduce or increase centralized power?
3. **Reputation check:** Would I be proud to have this public?
4. **Opportunity cost:** What am I NOT doing if I say yes?
5. **Exit check:** Can I walk away cleanly if needed?

### Build vs Buy vs Partner

| Criteria | Build | Buy | Partner |
|----------|-------|-----|---------|
| Core to mission | ✓ | ✗ | ✗ |
| Time-sensitive | ✗ | ✓ | ✓ |
| Expertise exists | ✓ | ✗ | ✓ |
| Control critical | ✓ | ✓ | ✗ |
| Budget constrained | ✗ | ✗ | ✓ |

---

## Messaging Frameworks

### Communication Tone Matrix

| Audience | Tone | Style |
|----------|------|-------|
| Family | Warm, personal | Casual, affectionate |
| Collaborators | Friendly, professional | Direct but encouraging |
| Investors | Confident, transparent | Data-driven, optimistic |
| Public | Authentic, principled | Clear, no jargon |
| Critics | Measured, firm | Facts over emotion |

### Message Clarity Test

Before sending anything external:
1. **One main point** — Can I summarize in one sentence?
2. **No jargon** — Would a smart 15-year-old understand?
3. **Values visible** — Does this reflect who I am?
4. **Action clear** — What do I want them to do/think/feel?

### Crisis Response Protocol

1. **Pause** — Never respond immediately to criticism
2. **Verify** — Is the criticism accurate?
3. **Decide**:
   - Accurate → Acknowledge, correct, move on
   - Inaccurate → Correct factually, no defensiveness
   - Opinion → Usually ignore, or engage thoughtfully if it matters
4. **Elevate if needed** — Does this need a longer response (blog post, thread)?

---

## Marketing Frameworks

### Content Pillars (Everclaw/Smart Agent)

1. **Own your inference** — Decentralized AI for individuals
2. **One agent, one human** — Augmentation, not replacement
3. **Open source first** — Trust through transparency
4. **Family sovereignty** — Technology serving the home

### Launch Playbook

```
Pre-launch:
├─ Build anticipation (countdown, teasers)
├─ Line up partners/affiliates
└─ Prepare assets for all channels

Launch day:
├─ Coordinated announcement across platforms
├─ Direct outreach to key contacts
└─ Monitor and engage enthusiastically

Post-launch:
├─ Amplify positive reactions
├─ Address questions quickly
└─ Document lessons learned
```

### Viral Narrative Structure

```
Hook (attention) → Tension (problem) → Resolution (solution) → Call to action
```

---

## Code Development Frameworks

### Before Writing Code

1. **Understand the problem** — Can I explain it in 2 sentences?
2. **Check for existing solutions** — Don't reinvent
3. **Design interfaces first** — What does it look like from outside?
4. **Plan for failure** — What could go wrong?

### Code Quality Checklist

- [ ] Works for the happy path
- [ ] Handles errors gracefully
- [ ] Has clear variable/function names
- [ ] Comments explain *why*, not *what*
- [ ] Can someone else maintain this?

### Deployment Protocol

1. **Test locally** — Does it work on my machine?
2. **Test in staging** — Does it work in a clean environment?
3. **Plan rollback** — How do I undo this?
4. **Deploy** — Prefer small, frequent releases
5. **Monitor** — Watch for 24-48 hours

### Git Discipline

- Never force push
- Never delete branches without merge
- Always create feature branches
- Meaningful commit messages
- Squash before merge if needed

---

## Prioritization

### Time Priority Matrix

| | Urgent | Not Urgent |
|---|--------|------------|
| **Important** | DO NOW | SCHEDULE |
| **Not Important** | DELEGATE | ELIMINATE |

### Family-First Filter

Before committing to anything:
1. Does this conflict with family time?
2. Does this serve my family's needs?
3. Will this create stress at home?

If any answer is problematic → Decline or negotiate.

---

## Learning Frameworks

### New Technology Evaluation

1. **Understand** — Read docs, try tutorial
2. **Assess** — How mature? Who's behind it? What's the community?
3. **Experiment** — Build something small
4. **Decide** — Adopt, monitor, or pass

### Skill Acquisition Cycle

```
Learn → Practice → Teach → Refine → Repeat
```

---

*Add new frameworks as patterns emerge. This is a living document.*