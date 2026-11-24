<script>
  import FreezeButton from './FreezeButton.svelte';
  import { freezeWait, listFreezeName, projectMeta, projectState, runMeta, sortProjects, stateLabel, waitingLabel, worktreeRows, worktreeState } from '../../js/list.js';

  let { projects = [], loaded = false, selectedId = null, actor = null, freeze = null, onselect, onsketch, onfreeze, onfreezename } = $props();

  const sorted = $derived(sortProjects(projects));
  const ask = waitingLabel({ kind: 'freeze' });
</script>

{#snippet actions(targetId, run, targetName)}
  {#if freezeWait(run)}<FreezeButton {actor} action="list-freeze" source={`list:${targetId}`} {freeze} className="primary list-freeze" extra={{ 'data-project-id': targetId, 'data-run-id': run.runId, 'data-goal-hash': run.waiting.goalHash ?? '' }} ariaLabel={listFreezeName(targetName, actor)} onfreeze={() => onfreeze(targetId, run)} onname={() => onfreezename(targetId)} />{#if run.waiting.sketch}<button type="button" class="ghost list-sketch" data-action="list-sketch" data-project-id={targetId} aria-label={`Look at the order sketch for ${targetName}`} onclick={(event) => onsketch(targetId, event.currentTarget)}>Sketch</button>{/if}{/if}
{/snippet}

<div id="project-list">
  {#if loaded}
    {#if !sorted.length}
      <p class="empty">No projects yet. AEL lists a project here once you run <code>ael init</code> or <code>ael run</code> in it.</p>
    {:else}
      <ul class="project-list">
        {#each sorted as project (project.id)}
          {@const state = projectState(project)}
          {@const worktrees = worktreeRows(project)}
          <li class="project" data-state={state}>
            <button type="button" class="project-row" data-project-id={project.id} aria-current={project.id === selectedId ? 'true' : undefined} onclick={() => onselect(project.id)}><span class="bot bot-{state}" role="img" aria-label={stateLabel(state)}></span><span class="row-name">{project.name}{#if freezeWait(project.run)}{' '}<span class="row-ask">· {ask}</span>{/if}</span><span class="row-meta">{projectMeta(project)}</span></button>{@render actions(project.id, project.run, project.name)}{#if worktrees.length}
              <ul class="worktree-runs" aria-label="Worktree Runs">
                {#each worktrees as run (run.worktreeId)}
                  {@const wstate = worktreeState(run)}
                  <li class="worktree-run" data-state={wstate}>
                    <button type="button" class="worktree-row" data-project-id={run.worktreeId} aria-current={run.worktreeId === selectedId ? 'true' : undefined} onclick={() => onselect(run.worktreeId)}><span class="bot bot-{wstate}" aria-hidden="true"></span><span class="worktree-task">{run.task || run.runId}{#if freezeWait(run)}{' '}<span class="row-ask">· {ask}</span>{/if}</span><span class="row-meta">{runMeta(run)}</span></button>{@render actions(run.worktreeId, run, run.task || run.runId)}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
