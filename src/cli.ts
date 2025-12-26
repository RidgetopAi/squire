#!/usr/bin/env node

import { Command } from 'commander';
import { createMemory, listMemories, countMemories } from './services/memories.js';
import { checkConnection, closePool } from './db/pool.js';

const program = new Command();

program
  .name('squier')
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
      const memory = await createMemory({
        content,
        source: options.source,
        content_type: options.type,
      });

      console.log('\nMemory stored successfully!');
      console.log(`  ID: ${memory.id}`);
      console.log(`  Salience: ${memory.salience_score}`);
      console.log(`  Created: ${memory.created_at}`);
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
        console.log('Use "squier observe <content>" to store your first memory.');
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
 * status - Check system health
 */
program
  .command('status')
  .description('Check system health and connection')
  .action(async () => {
    try {
      console.log('\nSquier Status\n');

      const dbConnected = await checkConnection();
      console.log(`  Database: ${dbConnected ? 'Connected' : 'Disconnected'}`);

      if (dbConnected) {
        const total = await countMemories();
        console.log(`  Memories: ${total}`);
      }

      console.log('');
    } catch (error) {
      console.error('Failed to check status:', error);
      process.exit(1);
    } finally {
      await closePool();
    }
  });

program.parse();
