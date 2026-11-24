<script>
  import { OUTCOMES, STAMPS, orderMeta, orderOutcome, orderSummary, orderTally } from '../../js/orders.js';

  let { runs = [], projectName = '', loading = false, error = null } = $props();

  const list = $derived(Array.isArray(runs) ? runs : []);
  const showSummary = $derived(!loading && !error && list.length > 0);
</script>

<div id="orders" class="orders-body">
  <div class="book">
    <section class="page page-left" aria-label="Cover page">
      <p class="book-kicker">The kitchen's</p><p class="book-name">Order book</p>
      {#if projectName}<p class="book-project">{projectName}</p>{/if}
      {#if showSummary}
        <p class="visually-hidden">{orderSummary(list)}</p>
        <ul class="tally" aria-hidden="true">
          {#each orderTally(list) as item (item.outcome)}
            <li data-outcome={item.outcome}><span class="tally-count">{item.count}</span> {item.label}</li>
          {/each}
        </ul>
      {/if}
      <p class="book-foot">Newest orders first</p>
    </section>
    <section class="page page-right" aria-label="Orders">
      {#if loading}
        <p class="order-empty">Leafing through the pages…</p>
      {:else if error}
        <p class="order-empty">Could not read the order book: {error}</p>
      {:else if !list.length}
        <p class="order-empty">No orders written yet.</p>
      {:else}
        <ol class="orders" aria-label="Recent Runs, newest first">
          {#each list as run, index}
            {@const outcome = orderOutcome(run)}
            <li class="order" data-outcome={outcome} aria-current={run.current ? 'true' : undefined}>
              <span class="order-no" aria-hidden="true">No. {list.length - index}</span>
              <span class="order-main"><b class="order-task">{run.task || 'Untitled order'}</b><span class="order-meta">{#if run.current}<span class="order-now">On the pass now</span>{' · '}{/if}{orderMeta(run)}</span></span>
              <span class="order-stamp" title={OUTCOMES[outcome]}>{STAMPS[outcome]}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>
</div>
