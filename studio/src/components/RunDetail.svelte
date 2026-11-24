<script>
  import { GOAL_VIEWS, GOAL_VIEW_LABELS, findingsText, safeLink } from '../../js/detail.js';
  import { renderMarkdown } from '../../js/markdown.js';
  import { tabKeys } from '../tabs.js';

  let { detail = null, goalView = 'formatted', onview } = $props();

  const view = $derived(GOAL_VIEWS.includes(goalView) ? goalView : 'formatted');
  const goalHtml = $derived(detail && detail.goalMarkdown ? renderMarkdown(detail.goalMarkdown) : '');
  const prUrl = $derived(detail && detail.pr ? safeLink(detail.pr.url) : null);
  const tabs = {};

  function keydown(event, name) {
    const next = tabKeys(event, GOAL_VIEWS, name);
    if (!next) return;
    onview(next);
    tabs[next].focus();
  }
</script>

{#snippet listOrNone(items)}
  {#if !items || !items.length}
    <p class="quiet-text">None</p>
  {:else}
    <ul>
      {#each items as item}
        <li>{item}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div id="run-detail" class="run-detail">
  {#if detail}
    <dl class="facts">
      <div><dt>Findings</dt><dd>{findingsText(detail.findings)}</dd></div>
      <div><dt>Pull request</dt><dd>{#if detail.pr}<code>{detail.pr.branch || 'unknown branch'}</code> · {detail.pr.merged ? 'merged' : 'not merged'}{#if prUrl}{' '}<a href={prUrl} target="_blank" rel="noopener noreferrer">open</a>{/if}{:else}No branch yet{/if}</dd></div>
      <div><dt>Receipt</dt><dd>{detail.receipt === 'written' ? 'Receipt written' : 'No receipt yet'}</dd></div>
    </dl>
    <section class="detail-card goal" aria-labelledby="goal-title">
      {#if !detail.goalMarkdown}
        <h3 id="goal-title">Goal</h3>
        <p class="quiet-text">No Goal draft yet.</p>
      {:else}
        <div class="goal-head">
          <h3 id="goal-title">Goal</h3>
          <div class="tabs" role="tablist" aria-label="Goal view">
            {#each GOAL_VIEWS as name}
              <button type="button" role="tab" id="goal-tab-{name}" aria-controls="goal-panel-{name}" aria-selected={name === view ? 'true' : 'false'} tabindex={name === view ? 0 : -1} data-goal-view={name} bind:this={tabs[name]} onclick={() => onview(name)} onkeydown={(event) => keydown(event, name)}>{GOAL_VIEW_LABELS[name]}</button>
            {/each}
          </div>
        </div>
        <div role="tabpanel" id="goal-panel-formatted" aria-labelledby="goal-tab-formatted" class="goal-formatted" tabindex="0" hidden={view !== 'formatted'}>{@html goalHtml}</div>
        <div role="tabpanel" id="goal-panel-markdown" aria-labelledby="goal-tab-markdown" tabindex="0" hidden={view !== 'markdown'}><pre class="goal-text">{detail.goalMarkdown}</pre></div>
      {/if}
    </section>
    <section class="detail-card" aria-labelledby="assumptions-title"><h3 id="assumptions-title">Unconfirmed assumptions</h3>{@render listOrNone(detail.unconfirmed)}</section>
    {#if detail.extraNodes && detail.extraNodes.length}
      <section class="detail-card" aria-labelledby="extra-title"><h3 id="extra-title">Other steps</h3>{@render listOrNone(detail.extraNodes)}</section>
    {/if}
  {/if}
</div>
