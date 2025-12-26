#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { createMemory, listMemories, countMemories, searchMemories, getMemory } from './services/memories.js';
import { generateContext, listProfiles } from './services/context.js';
import {
  listEntities,
  findEntityByName,
  countEntitiesByType,
  EntityType,
} from './services/entities.js';
import { consolidateAll, getConsolidationStats } from './services/consolidation.js';
import { getRelatedMemories, getEdgeStats } from './services/edges.js';
import { parseImportFile, importMemories, getImportStats } from './services/import.js';
import {
  getAllSummaries,
  getSummary,
  generateSummary,
  updateAllSummaries,
  getSummaryStats,
  isValidCategory,
  SUMMARY_CATEGORIES,
  classifyMemoryCategories,
  linkMemoryToCategories,
  type SummaryCategory,
} from './services/summaries.js';
import {
  processMemoryForBeliefs,
  getAllBeliefs,
  getBelief,
  getBeliefEvidence,
  getBeliefStats,
  getUnresolvedConflicts,
  isValidBeliefType,
  BELIEF_TYPES,
  getBeliefTypeDescription,
  type BeliefType,
} from './services/beliefs.js';
import { pool, checkConnection, closePool } from './db/pool.js';
import { checkEmbeddingHealth } from './providers/embeddings.js';
import { checkLLMHealth, getLLMInfo } from './providers/llm.js';
import { config } from './config/index.js';

const program = new Command();

program
  .name('squire')
  .description('AI memory system - memory that knows the user')
  .version('0.1.0');

/**
 * observe - Store a new memory
 */
program
  .command('observe')
  .description('Store a new observation as a memory')
  .argument('<content>', 'The content to remember')
  .option('-s, --source <source>', 'Source of the observation', 'cli')
  .option('-t, --type <type>', 'Content type', 'text')
  .action(async (content: string, options: { source: string; type: string }) => {
    try {
      const { memory, entities } = await createMemory({
        content,
        source: options.source,
        content_type: options.type,
      });

      console.log('\nMemory stored successfully!');
      console.log(`  ID: ${memory.id}`);
      console.log(`  Salience: ${memory.salience_score}`);
      console.log(`  Created: ${memory.created_at}`);

      if (entities.length > 0) {
        const entityList = entities.map((e) => `${e.name} (${e.entity_type})`).join(', ');
        console.log(`  Entities: ${entityList}`);
      }

      // Classify memory into summary categories
      const classifications = await classifyMemoryCategories(content);
      if (classifications.length > 0) {
        await linkMemoryToCategories(memory.id, classifications);
        const categories = classifications.map((c) => c.category).join(', ');
        console.log(`  Categories: ${categories}`);
      }

      // Extract beliefs from memory
      const beliefResult = await processMemoryForBeliefs(memory.id, content);
      if (beliefResult.created.length > 0 || beliefResult.reinforced.length > 0) {
        const parts: string[] = [];
        if (beliefResult.created.length > 0) {
          parts.push(`${beliefResult.created.length} new`);
        }
        if (beliefResult.reinforced.length > 0) {
          parts.push(`${beliefResult.reinforced.length} reinforced`);
        }
        console.log(`  Beliefs: ${parts.join(', ')}`);

        if (beliefResult.conflicts.length > 0) {
          console.log(`  ⚠ ${beliefResult.conflicts.length} belief conflict(s) detected`);
        }
      }
    } catch (error) {
      console.error('Failed to store memory:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * list - List stored memories
 */
program
  .command('list')
  .description('List stored memories')
  .option('-l, --limit <limit>', 'Maximum number of memories to show', '10')
  .option('-s, --source <source>', 'Filter by source')
  .action(async (options: { limit: string; source?: string }) => {
    try {
      const limit = parseInt(options.limit, 10);
      const [memories, total] = await Promise.all([
        listMemories({ limit, source: options.source }),
        countMemories(),
      ]);

      if (memories.length === 0) {
        console.log('\nNo memories found.');
        console.log('Use "squire observe <content>" to store your first memory.');
      } else {
        console.log(`\nMemories (${memories.length} of ${total}):\n`);

        for (const memory of memories) {
          const date = new Date(memory.created_at).toLocaleString();
          const preview = memory.content.length > 60
            ? memory.content.substring(0, 60) + '...'
            : memory.content;

          console.log(`[${memory.id.substring(0, 8)}] ${date}`);
          console.log(`  ${preview}`);
          console.log(`  salience: ${memory.salience_score} | source: ${memory.source}`);
          console.log('');
        }
      }
    } catch (error) {
      console.error('Failed to list memories:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * search - Semantic search for memories
 */
program
  .command('search')
  .description('Semantic search for memories')
  .argument('<query>', 'Search query')
  .option('-l, --limit <limit>', 'Maximum number of results', '10')
  .option('-m, --min-similarity <min>', 'Minimum similarity threshold (0-1)', '0.3')
  .action(async (query: string, options: { limit: string; minSimilarity: string }) => {
    try {
      const limit = parseInt(options.limit, 10);
      const minSimilarity = parseFloat(options.minSimilarity);

      console.log(`\nSearching for: "${query}"\n`);

      const results = await searchMemories(query, { limit, minSimilarity });

      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        console.log(`Found ${results.length} matching memories:\n`);

        for (const memory of results) {
          const date = new Date(memory.created_at).toLocaleString();
          const similarity = (memory.similarity * 100).toFixed(1);
          const salience = memory.salience_score.toFixed(1);
          const score = (memory.combined_score * 100).toFixed(1);
          const preview = memory.content.length > 70
            ? memory.content.substring(0, 70) + '...'
            : memory.content;

          console.log(`[${memory.id.substring(0, 8)}] score: ${score}%`);
          console.log(`  ${preview}`);
          console.log(`  ${date} | similarity: ${similarity}% | salience: ${salience}`);
          console.log('');
        }
      }
    } catch (error) {
      console.error('Failed to search memories:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * context - Get context package for AI (Slice 3)
 */
program
  .command('context')
  .description('Get context package for AI consumption')
  .option('-p, --profile <name>', 'Context profile (general, work, personal, creative)')
  .option('-q, --query <query>', 'Focus context on this query')
  .option('-t, --max-tokens <tokens>', 'Maximum tokens in output')
  .option('--json', 'Output as JSON instead of markdown')
  .action(async (options: { profile?: string; query?: string; maxTokens?: string; json?: boolean }) => {
    try {
      const maxTokens = options.maxTokens ? parseInt(options.maxTokens, 10) : undefined;

      const contextPackage = await generateContext({
        profile: options.profile,
        query: options.query,
        maxTokens,
      });

      if (options.json) {
        console.log(JSON.stringify(contextPackage.json, null, 2));
      } else {
        console.log('');
        console.log(contextPackage.markdown);
        console.log(`---`);
        console.log(`Tokens: ~${contextPackage.token_count} | Memories: ${contextPackage.memories.length} | Disclosure: ${contextPackage.disclosure_id.substring(0, 8)}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to get context:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * profiles - List available context profiles
 */
program
  .command('profiles')
  .description('List available context profiles')
  .action(async () => {
    try {
      const profiles = await listProfiles();

      console.log('\nContext Profiles:\n');

      for (const profile of profiles) {
        const defaultTag = profile.is_default ? ' (default)' : '';
        const weights = profile.scoring_weights as { salience: number; relevance: number; recency: number; strength: number };

        console.log(`  ${profile.name}${defaultTag}`);
        console.log(`    ${profile.description || 'No description'}`);
        console.log(`    min_salience: ${profile.min_salience} | max_tokens: ${profile.max_tokens}`);
        console.log(`    weights: sal=${weights.salience} rel=${weights.relevance} rec=${weights.recency} str=${weights.strength}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to list profiles:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * entities - List extracted entities
 */
program
  .command('entities')
  .description('List extracted entities (people, projects, etc.)')
  .option('-t, --type <type>', 'Filter by type (person, project, concept, place, organization)')
  .option('-l, --limit <limit>', 'Maximum number to show', '20')
  .option('-s, --search <query>', 'Search by name')
  .action(async (options: { type?: string; limit: string; search?: string }) => {
    try {
      const limit = parseInt(options.limit, 10);
      const type = options.type as EntityType | undefined;

      const [entities, counts] = await Promise.all([
        listEntities({ type, limit, search: options.search }),
        countEntitiesByType(),
      ]);

      const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

      console.log('\nEntities\n');
      console.log(`  Total: ${totalCount}`);
      console.log(`  By type: person=${counts.person} project=${counts.project} place=${counts.place} org=${counts.organization} concept=${counts.concept}`);
      console.log('');

      if (entities.length === 0) {
        console.log('  No entities found.');
        console.log('  Entities are extracted automatically when you observe memories.');
      } else {
        for (const entity of entities) {
          const lastSeen = new Date(entity.last_seen_at).toLocaleDateString();
          console.log(`  [${entity.entity_type}] ${entity.name}`);
          console.log(`    mentions: ${entity.mention_count} | last seen: ${lastSeen}`);
          console.log('');
        }
      }
    } catch (error) {
      console.error('Failed to list entities:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * who - Query everything about a person/entity
 */
program
  .command('who')
  .description('What do I know about a person or entity?')
  .argument('<name>', 'Name to search for')
  .action(async (name: string) => {
    try {
      const result = await findEntityByName(name);

      if (!result) {
        console.log(`\nNo entity found matching "${name}"`);
        console.log('Try `squire entities` to see all known entities.');
        return;
      }

      console.log(`\n${result.name}`);
      console.log(`  Type: ${result.entity_type}`);
      console.log(`  Mentions: ${result.mention_count}`);
      console.log(`  First seen: ${new Date(result.first_seen_at).toLocaleDateString()}`);
      console.log(`  Last seen: ${new Date(result.last_seen_at).toLocaleDateString()}`);

      if (result.memories.length > 0) {
        console.log('\nRelated Memories:\n');

        for (const mem of result.memories.slice(0, 10)) {
          const date = new Date(mem.created_at).toLocaleDateString();
          const preview = mem.content.length > 70
            ? mem.content.substring(0, 70) + '...'
            : mem.content;

          console.log(`  [${mem.id.substring(0, 8)}] ${date}`);
          console.log(`    ${preview}`);
          console.log(`    salience: ${mem.salience_score}`);
          console.log('');
        }

        if (result.memories.length > 10) {
          console.log(`  ... and ${result.memories.length - 10} more memories`);
        }
      }
    } catch (error) {
      console.error('Failed to query entity:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * status - Check system health
 */
program
  .command('status')
  .description('Check system health and connection')
  .action(async () => {
    try {
      console.log('\nSquire Status\n');

      const [dbConnected, embeddingConnected, llmConnected] = await Promise.all([
        checkConnection(),
        checkEmbeddingHealth(),
        checkLLMHealth(),
      ]);

      const llmInfo = getLLMInfo();

      console.log(`  Database: ${dbConnected ? 'Connected' : 'Disconnected'}`);
      console.log(`  Embedding: ${embeddingConnected ? 'Connected' : 'Disconnected'}`);
      console.log(`    Provider: ${config.embedding.provider}`);
      console.log(`    Model: ${config.embedding.model}`);
      console.log(`    Dimension: ${config.embedding.dimension}`);
      console.log(`  LLM: ${llmConnected ? 'Connected' : 'Disconnected'}`);
      console.log(`    Provider: ${llmInfo.provider}`);
      console.log(`    Model: ${llmInfo.model}`);
      console.log(`    Configured: ${llmInfo.configured ? 'Yes' : 'No (set GROQ_API_KEY)'}`);

      if (dbConnected) {
        const [total, entityCounts, consolidationStats, edgeStats, summaryStats] = await Promise.all([
          countMemories(),
          countEntitiesByType(),
          getConsolidationStats(),
          getEdgeStats(),
          getSummaryStats(),
        ]);
        const entityTotal = Object.values(entityCounts).reduce((a, b) => a + b, 0);
        console.log(`  Memories: ${total} (${consolidationStats.activeMemories} active, ${consolidationStats.dormantMemories} dormant)`);
        console.log(`  Entities: ${entityTotal}`);
        console.log(`  Edges: ${edgeStats.total} SIMILAR connections`);
        console.log(`  Summaries: ${summaryStats.withContent}/${summaryStats.categories} (${summaryStats.pendingMemories} pending)`);
      }

      console.log('');
    } catch (error) {
      console.error('Failed to check status:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * consolidate - Run memory consolidation (decay, strengthen, edges)
 */
program
  .command('consolidate')
  .description('Run memory consolidation (decay, strengthen, form connections)')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options: { verbose?: boolean }) => {
    try {
      console.log('\nRunning consolidation...\n');

      const result = await consolidateAll();

      console.log('Consolidation complete!');
      console.log(`  Memories processed: ${result.memoriesProcessed}`);
      console.log(`  Decayed: ${result.memoriesDecayed}`);
      console.log(`  Strengthened: ${result.memoriesStrengthened}`);
      console.log(`  Edges created: ${result.edgesCreated}`);
      console.log(`  Edges reinforced: ${result.edgesReinforced}`);
      console.log(`  Edges pruned: ${result.edgesPruned}`);
      console.log(`  Duration: ${result.durationMs}ms`);

      if (options.verbose) {
        const stats = await getConsolidationStats();
        console.log('\nCurrent State:');
        console.log(`  Active memories: ${stats.activeMemories}`);
        console.log(`  Dormant memories: ${stats.dormantMemories}`);
        console.log(`  Total edges: ${stats.totalEdges}`);
        console.log(`  Average edge weight: ${stats.averageWeight.toFixed(2)}`);
      }

      console.log('');
    } catch (error) {
      console.error('Consolidation failed:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * sleep - Friendly alias for consolidate
 */
program
  .command('sleep')
  .description('Let Squire consolidate memories (alias for consolidate)')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options: { verbose?: boolean }) => {
    try {
      console.log('\nSquire is sleeping... consolidating memories...\n');

      const result = await consolidateAll();

      console.log('Squire wakes up refreshed!');
      console.log(`  Processed ${result.memoriesProcessed} memories`);
      console.log(`  ${result.memoriesDecayed} faded, ${result.memoriesStrengthened} strengthened`);
      console.log(`  ${result.edgesCreated} new connections formed`);

      if (options.verbose) {
        console.log(`  ${result.edgesReinforced} connections reinforced`);
        console.log(`  ${result.edgesPruned} weak connections pruned`);
      }

      console.log('');
    } catch (error) {
      console.error('Sleep failed:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * related - Show memories connected via SIMILAR edges
 */
program
  .command('related')
  .description('Show memories connected to a given memory')
  .argument('<memory-id>', 'Memory ID (can be partial)')
  .option('-l, --limit <limit>', 'Maximum number of related memories', '10')
  .action(async (memoryId: string, options: { limit: string }) => {
    try {
      const limit = parseInt(options.limit, 10);

      // Allow partial IDs - find the full ID
      let fullId = memoryId;
      if (memoryId.length < 36) {
        const memory = await getMemory(memoryId);
        if (!memory) {
          // Try to find by prefix
          console.log(`\nLooking for memory starting with "${memoryId}"...`);
          console.log('Use `squire list` to see available memories.');
          return;
        }
        fullId = memory.id;
      }

      const memory = await getMemory(fullId);
      if (!memory) {
        console.log(`\nMemory not found: ${memoryId}`);
        return;
      }

      console.log(`\nMemory: ${memory.id.substring(0, 8)}`);
      console.log(`  ${memory.content.length > 60 ? memory.content.substring(0, 60) + '...' : memory.content}`);
      console.log(`  salience: ${memory.salience_score} | strength: ${memory.current_strength.toFixed(2)}`);

      const related = await getRelatedMemories(fullId, { limit });

      if (related.length === 0) {
        console.log('\nNo connected memories found.');
        console.log('Run `squire consolidate` to form connections between similar memories.');
      } else {
        console.log(`\nConnected Memories (${related.length}):\n`);

        for (const mem of related) {
          const preview = mem.content.length > 60
            ? mem.content.substring(0, 60) + '...'
            : mem.content;
          const similarity = mem.edge_similarity ? (mem.edge_similarity * 100).toFixed(0) : '?';

          console.log(`  [${mem.id.substring(0, 8)}] weight: ${mem.edge_weight.toFixed(2)} | similarity: ${similarity}%`);
          console.log(`    ${preview}`);
          console.log('');
        }
      }
    } catch (error) {
      console.error('Failed to get related memories:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * import - Import memories from JSON file
 */
program
  .command('import')
  .description('Import memories from a JSON file (JSONL or array format)')
  .argument('<file>', 'Path to JSON file containing memories')
  .option('--allow-duplicates', 'Import even if similar content exists')
  .option('--skip-entities', 'Skip entity extraction (faster)')
  .option('--min-length <chars>', 'Minimum content length to import', '10')
  .option('--dry-run', 'Show what would be imported without importing')
  .option('-q, --quiet', 'Only show summary, not each memory')
  .action(async (
    file: string,
    options: {
      allowDuplicates?: boolean;
      skipEntities?: boolean;
      minLength: string;
      dryRun?: boolean;
      quiet?: boolean;
    }
  ) => {
    try {
      // Read and parse the file
      console.log(`\nReading ${file}...`);
      const content = readFileSync(file, 'utf-8');
      const memories = parseImportFile(content);

      console.log(`Found ${memories.length} memories to import\n`);

      if (memories.length === 0) {
        console.log('No valid memories found in file.');
        console.log('Expected format: JSONL or JSON array with { content, occurred_at?, source?, tags? }');
        return;
      }

      // Show preview in dry-run mode
      if (options.dryRun) {
        console.log('DRY RUN - would import:\n');
        for (const mem of memories.slice(0, 10)) {
          const date = mem.occurred_at
            ? new Date(mem.occurred_at).toLocaleDateString()
            : 'no date';
          const tags = mem.tags?.join(', ') || 'no tags';
          const preview = mem.content.length > 70
            ? mem.content.substring(0, 70) + '...'
            : mem.content;

          console.log(`  [${date}] ${preview}`);
          console.log(`    source: ${mem.source || 'import'} | tags: ${tags}`);
          console.log('');
        }
        if (memories.length > 10) {
          console.log(`  ... and ${memories.length - 10} more`);
        }
        return;
      }

      // Import with progress
      const minLength = parseInt(options.minLength, 10);
      const result = await importMemories(memories, {
        allowDuplicates: options.allowDuplicates,
        skipEntities: options.skipEntities,
        minLength,
        onProgress: options.quiet ? undefined : (current, total, preview) => {
          process.stdout.write(`\r  [${current}/${total}] ${preview.padEnd(60)}`);
        },
      });

      if (!options.quiet) {
        console.log('\n');
      }

      // Show results
      console.log('Import complete!\n');
      console.log(`  Total in file: ${result.total}`);
      console.log(`  Imported: ${result.imported}`);
      console.log(`  Skipped: ${result.skipped} (duplicates or too short)`);
      console.log(`  Errors: ${result.errors}`);

      if (result.imported > 0 && !options.quiet) {
        console.log('\nSample imported memories:\n');
        for (const mem of result.memories.slice(0, 5)) {
          console.log(`  [${mem.id.substring(0, 8)}] salience: ${mem.salience.toFixed(1)} | entities: ${mem.entities}`);
          console.log(`    ${mem.content}...`);
          console.log('');
        }
        if (result.memories.length > 5) {
          console.log(`  ... and ${result.memories.length - 5} more`);
        }
      }

      if (result.errors > 0) {
        console.log('\nErrors:');
        for (const err of result.errorDetails.slice(0, 5)) {
          console.log(`  ${err}`);
        }
      }

      console.log('\nRun `squire consolidate` to form connections between memories.');
      console.log('');
    } catch (error) {
      console.error('Failed to import:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * import-stats - Show import statistics
 */
program
  .command('import-stats')
  .description('Show statistics about imported memories')
  .action(async () => {
    try {
      const stats = await getImportStats();

      console.log('\nImport Statistics\n');
      console.log(`  Total imported: ${stats.totalImported}`);

      if (Object.keys(stats.bySources).length > 0) {
        console.log('\n  By source:');
        for (const [source, count] of Object.entries(stats.bySources)) {
          console.log(`    ${source}: ${count}`);
        }
      }

      if (stats.dateRange.oldest) {
        console.log('\n  Date range:');
        console.log(`    Oldest: ${stats.dateRange.oldest.toLocaleDateString()}`);
        console.log(`    Newest: ${stats.dateRange.newest?.toLocaleDateString()}`);
      }

      console.log('');
    } catch (error) {
      console.error('Failed to get import stats:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * summary - Show a living summary by category
 */
program
  .command('summary')
  .description('Show a living summary by category')
  .argument('<category>', `Category: ${SUMMARY_CATEGORIES.join(', ')}`)
  .option('-r, --regenerate', 'Regenerate the summary from pending memories')
  .action(async (category: string, options: { regenerate?: boolean }) => {
    try {
      if (!isValidCategory(category)) {
        console.log(`\nInvalid category: "${category}"`);
        console.log(`Valid categories: ${SUMMARY_CATEGORIES.join(', ')}`);
        return;
      }

      if (options.regenerate) {
        console.log(`\nRegenerating ${category} summary...`);
        const result = await generateSummary(category as SummaryCategory);

        if (result.memoriesProcessed === 0) {
          console.log('No new memories to incorporate.');
        } else {
          console.log(`Incorporated ${result.memoriesProcessed} new memories.`);
        }
        console.log('');
      }

      const summary = await getSummary(category as SummaryCategory);
      if (!summary) {
        console.log(`\nSummary not found: ${category}`);
        return;
      }

      console.log(`\n${category.toUpperCase()}`);
      console.log(`${'─'.repeat(40)}`);

      if (!summary.content) {
        console.log('No summary yet. Add memories and run regeneration.');
        console.log(`\nTry: squire summary ${category} --regenerate`);
      } else {
        console.log(summary.content);
      }

      console.log(`${'─'.repeat(40)}`);
      console.log(`Version: ${summary.version} | Memories: ${summary.memory_count} | Last updated: ${summary.last_updated_at.toLocaleString()}`);
      console.log('');
    } catch (error) {
      console.error('Failed to get summary:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * summaries - List all living summaries
 */
program
  .command('summaries')
  .description('List all living summaries')
  .option('-a, --all', 'Show all categories including empty ones')
  .option('-r, --regenerate', 'Regenerate all summaries with pending memories')
  .action(async (options: { all?: boolean; regenerate?: boolean }) => {
    try {
      if (options.regenerate) {
        console.log('\nUpdating all summaries with pending memories...\n');
        const result = await updateAllSummaries();

        if (result.updated.length === 0) {
          console.log('No summaries needed updating.');
        } else {
          console.log(`Updated ${result.updated.length} summaries:`);
          for (const cat of result.updated) {
            console.log(`  - ${cat}`);
          }
          console.log(`\nTotal memories processed: ${result.memoriesProcessed}`);
        }
        console.log('');
      }

      const summaries = await getAllSummaries();
      const stats = await getSummaryStats();

      console.log('\nLiving Summaries\n');
      console.log(`  Categories: ${stats.categories}`);
      console.log(`  With content: ${stats.withContent}`);
      console.log(`  Pending memories: ${stats.pendingMemories}`);
      console.log('');

      for (const summary of summaries) {
        if (!options.all && !summary.content) continue;

        const preview = summary.content
          ? (summary.content.length > 80 ? summary.content.substring(0, 80) + '...' : summary.content)
          : '(empty)';
        const stale = summary.staleness_score > 0.3 ? ' [stale]' : '';

        console.log(`  ${summary.category}${stale}`);
        console.log(`    ${preview}`);
        console.log(`    v${summary.version} | ${summary.memory_count} memories | ${summary.last_updated_at.toLocaleDateString()}`);
        console.log('');
      }

      if (stats.pendingMemories > 0) {
        console.log(`Run 'squire summaries --regenerate' to incorporate ${stats.pendingMemories} pending memories.`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to list summaries:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * classify - Classify a memory into categories (for debugging/testing)
 */
program
  .command('classify')
  .description('Classify text into summary categories (for testing)')
  .argument('<content>', 'Content to classify')
  .action(async (content: string) => {
    try {
      console.log(`\nClassifying: "${content.substring(0, 60)}${content.length > 60 ? '...' : ''}"\n`);

      const classifications = await classifyMemoryCategories(content);

      if (classifications.length === 0) {
        console.log('No categories detected for this content.');
      } else {
        console.log('Categories:');
        for (const c of classifications) {
          const relevance = (c.relevance * 100).toFixed(0);
          console.log(`  ${c.category}: ${relevance}%`);
          if (c.reason) {
            console.log(`    ${c.reason}`);
          }
        }
      }
      console.log('');
    } catch (error) {
      console.error('Classification failed:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * backfill-summaries - Classify existing memories for summaries
 */
program
  .command('backfill-summaries')
  .description('Classify existing memories into summary categories')
  .option('-l, --limit <limit>', 'Maximum number of memories to process', '50')
  .option('--dry-run', 'Show what would be classified without doing it')
  .action(async (options: { limit: string; dryRun?: boolean }) => {
    try {
      const limit = parseInt(options.limit, 10);

      // Find memories not yet linked to any summary
      const result = await pool.query<{ id: string; content: string }>(
        `SELECT m.id, m.content FROM memories m
         WHERE NOT EXISTS (
           SELECT 1 FROM memory_summary_links msl WHERE msl.memory_id = m.id
         )
         ORDER BY m.created_at DESC
         LIMIT $1`,
        [limit]
      );

      const unclassified = result.rows;

      console.log(`\nFound ${unclassified.length} unclassified memories.\n`);

      if (unclassified.length === 0) {
        console.log('All memories are already classified.');
        return;
      }

      if (options.dryRun) {
        console.log('DRY RUN - would classify:');
        for (const mem of unclassified.slice(0, 10)) {
          const preview = mem.content.length > 60
            ? mem.content.substring(0, 60) + '...'
            : mem.content;
          console.log(`  ${mem.id.substring(0, 8)}: ${preview}`);
        }
        if (unclassified.length > 10) {
          console.log(`  ... and ${unclassified.length - 10} more`);
        }
        return;
      }

      console.log('Classifying memories...\n');

      let classified = 0;
      let totalCategories = 0;

      for (const mem of unclassified) {
        const preview = mem.content.length > 40
          ? mem.content.substring(0, 40) + '...'
          : mem.content;
        process.stdout.write(`\r  [${classified + 1}/${unclassified.length}] ${preview.padEnd(45)}`);

        const classifications = await classifyMemoryCategories(mem.content);
        if (classifications.length > 0) {
          await linkMemoryToCategories(mem.id, classifications);
          totalCategories += classifications.length;
        }
        classified++;
      }

      console.log(`\n\nBackfill complete!`);
      console.log(`  Memories classified: ${classified}`);
      console.log(`  Category links created: ${totalCategories}`);
      console.log(`\nRun 'squire summaries --regenerate' to update summaries.`);
      console.log('');
    } catch (error) {
      console.error('Backfill failed:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * beliefs - List all beliefs
 */
program
  .command('beliefs')
  .description('List extracted beliefs')
  .option('-t, --type <type>', 'Filter by belief type')
  .option('-l, --limit <limit>', 'Maximum number to show', '20')
  .option('--conflicts', 'Show unresolved conflicts only')
  .action(async (options: { type?: string; limit: string; conflicts?: boolean }) => {
    try {
      // Show conflicts if requested
      if (options.conflicts) {
        const conflicts = await getUnresolvedConflicts();

        console.log(`\nUnresolved Belief Conflicts (${conflicts.length})\n`);

        if (conflicts.length === 0) {
          console.log('No unresolved conflicts.');
        } else {
          for (const c of conflicts) {
            console.log(`[${c.id.substring(0, 8)}] ${c.conflict_type}`);
            console.log(`  A: "${c.belief_a_content}"`);
            console.log(`  B: "${c.belief_b_content}"`);
            if (c.conflict_description) {
              console.log(`  ${c.conflict_description}`);
            }
            console.log('');
          }
        }
        return;
      }

      // Validate type if provided
      if (options.type && !isValidBeliefType(options.type)) {
        console.log(`\nInvalid belief type: ${options.type}`);
        console.log(`Valid types: ${BELIEF_TYPES.join(', ')}`);
        return;
      }

      const limit = parseInt(options.limit, 10);
      const beliefs = await getAllBeliefs({
        type: options.type as BeliefType | undefined,
        limit,
      });

      const stats = await getBeliefStats();

      console.log('\nBeliefs\n');
      console.log(`  Total: ${stats.total} | Active: ${stats.active} | Conflicted: ${stats.conflicted}`);
      if (stats.unresolvedConflicts > 0) {
        console.log(`  ⚠ ${stats.unresolvedConflicts} unresolved conflict(s)`);
      }
      console.log('');

      if (beliefs.length === 0) {
        console.log('No beliefs extracted yet.');
        console.log('Beliefs are extracted automatically when you observe memories.');
      } else {
        for (const b of beliefs) {
          const conf = (b.confidence * 100).toFixed(0);
          const status = b.status !== 'active' ? ` [${b.status}]` : '';
          console.log(`[${b.id.substring(0, 8)}] ${b.belief_type}${status}`);
          console.log(`  "${b.content}"`);
          console.log(`  confidence: ${conf}% | sources: ${b.source_memory_count} | reinforced: ${b.reinforcement_count}x`);
          console.log('');
        }
      }

      if (options.type) {
        console.log(`Showing ${options.type} beliefs only. Remove --type to see all.`);
      }
      console.log('');
    } catch (error) {
      console.error('Failed to list beliefs:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

/**
 * belief - Show a specific belief with evidence
 */
program
  .command('belief')
  .description('Show a specific belief with its evidence')
  .argument('<id>', 'Belief ID (can be partial)')
  .action(async (id: string) => {
    try {
      // Try to find by partial ID
      let belief = await getBelief(id);

      if (!belief && id.length < 36) {
        // Search for partial match
        const all = await getAllBeliefs({ limit: 100 });
        const match = all.find(b => b.id.startsWith(id));
        if (match) {
          belief = match;
        }
      }

      if (!belief) {
        console.log(`\nBelief not found: ${id}`);
        console.log('Use `squire beliefs` to see available beliefs.');
        return;
      }

      const evidence = await getBeliefEvidence(belief.id);

      console.log(`\nBelief: ${belief.id}`);
      console.log(`${'─'.repeat(50)}`);
      console.log(`"${belief.content}"`);
      console.log('');
      console.log(`  Type: ${belief.belief_type} (${getBeliefTypeDescription(belief.belief_type)})`);
      console.log(`  Status: ${belief.status}`);
      console.log(`  Confidence: ${(belief.confidence * 100).toFixed(0)}%`);
      console.log(`  Reinforced: ${belief.reinforcement_count} times`);
      console.log(`  First seen: ${belief.first_extracted_at.toLocaleString()}`);
      if (belief.last_reinforced_at) {
        console.log(`  Last reinforced: ${belief.last_reinforced_at.toLocaleString()}`);
      }
      console.log('');

      if (evidence.length > 0) {
        console.log(`Evidence (${evidence.length} memories):`);
        for (const e of evidence) {
          const strength = (e.support_strength * 100).toFixed(0);
          const preview = e.memory_content.length > 60
            ? e.memory_content.substring(0, 60) + '...'
            : e.memory_content;
          console.log(`  [${e.memory_id.substring(0, 8)}] ${e.evidence_type} (${strength}%)`);
          console.log(`    ${preview}`);
        }
      }
      console.log('');
    } catch (error) {
      console.error('Failed to get belief:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

program.parse();
