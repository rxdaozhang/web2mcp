import { Stagehand } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import dotenv from "dotenv";
import crypto from "crypto";

// Load environment variables from .env file in the same directory
dotenv.config({ path: ".env" });

// Configuration - Environment variables with fallback defaults
const config = {
	url: process.env.SPA_CRAWLER_URL || "https://example.com/login",
	username: process.env.SPA_CRAWLER_USERNAME || "your_username",
	password: process.env.SPA_CRAWLER_PASSWORD || "your_password",
	maxDepth: parseInt(process.env.SPA_CRAWLER_MAX_DEPTH || "1"),
	openaiApiKey: process.env.OPENAI_API_KEY || "your-openai-key",
	environment: process.env.SPA_CRAWLER_ENV || "LOCAL" // LOCAL or BROWSERBASE
};

// Types
interface PathObject {
	intra_page_path: string;
	is_new_link: boolean;
}

interface QueueItem {
	path: PathObject[];
	depth: number;
}

interface TableData {
	selector: string;
	type: 'table' | 'list' | 'grid' | 'card';
	headers?: string[];
	rows?: any[][];
	textContent: string;
	elementCount: number;
}

// Utility functions
function page_hash(url: string): string {
	// Simple hash function for URL - lowercase and hash
	return crypto.createHash('md5').update(url.toLowerCase()).digest('hex');
}

async function login(stagehand: Stagehand, url: string, username: string, password: string): Promise<void> {
	// TODO: More accurate login detection
	// TODO: Bot detection circumvention
	console.info("Starting login process...");
	
	// Navigate to login page
	await stagehand.page.goto(url);
	
	// Wait for page to load
	await stagehand.page.waitForTimeout(5000);
    await stagehand.page.act('Accept any cookies pop-up on the page');
	
	// TODO: Use the agent to handle login more robustly
	/*
	const agent = stagehand.agent({
		provider: "openai",
		instructions: "You are a helpful assistant that can use a web browser. You will be logging into the specified website.",
		model: "computer-use-preview",
		options: {
			apiKey: config.openaiApiKey
		},
	});
	await agent.execute({
		instruction: ...,
		maxSteps: 30
	});
	*/
	
	// Execute login with the agent
    await stagehand.page.act(`Enter username ${username}`);
    await stagehand.page.act(`Enter password ${password}`);
    await stagehand.page.act('Click on the sign in button');
	
	// Wait for login to complete
	await stagehand.page.waitForTimeout(3000);
	
	console.info("Login completed successfully!");
}

async function navigate_to_page(stagehand: Stagehand, current_path: PathObject[], new_path: PathObject[]): Promise<void> {
	// TODO: Implement navigation logic
	// This should handle going back to previous pages and clicking buttons to reach the specified path
	console.info(`Navigating from path ${JSON.stringify(current_path)} to ${JSON.stringify(new_path)}`);
	
	// For now, just wait a bit to simulate navigation
	await stagehand.page.waitForTimeout(1000);
}

async function extractTabularData(stagehand: Stagehand): Promise<TableData[]> {
	const tabularData: TableData[] = [];
	const seenSelectors = new Set<string>();
	
	try {
		// Find container elements that hold collections of data
		const containers = await stagehand.page.observe({
			instruction: "Find the main container elements that hold collections of similar items. Look for elements that contain multiple similar child elements like tables, lists, grids, or repeated card-like structures. Focus on the parent containers, not individual items."
		});
		
		containers.forEach((container, index) => {
			const description = container.description.toLowerCase();
			let type: 'table' | 'list' | 'grid' | 'card' = 'card';
			
			// Determine the type based on description and selector
			if (description.includes('table') || container.selector.includes('table')) {
				type = 'table';
			} else if (description.includes('list') || 
					   container.selector.includes('ul') || 
					   container.selector.includes('ol')) {
				type = 'list';
			} else if (description.includes('grid') || 
					   description.includes('row') || 
					   description.includes('collection')) {
				type = 'grid';
			}
			
			// Only add if it's likely a container with multiple items
			if (description.includes('multiple') || 
				description.includes('list of') || 
				description.includes('collection') ||
				description.includes('table') ||
				description.includes('grid') ||
				description.includes('items') ||
				description.includes('cards')) {
				
				// Check for duplicates
				if (!seenSelectors.has(container.selector)) {
					seenSelectors.add(container.selector);
					tabularData.push({
						selector: container.selector,
						type: type,
						textContent: container.description,
						elementCount: 1
					});
				}
			}
		});
		
		// Also look specifically for data collection containers
		const dataCollections = await stagehand.page.observe({
			instruction: "Find elements that represent collections of data like email lists, product catalogs, user lists, dashboard widgets, or any container that holds multiple similar data items. Focus on the container, not the individual items."
		});
		
		dataCollections.forEach((element, index) => {
			const description = element.description.toLowerCase();
			
			// Skip if already captured
			if (!seenSelectors.has(element.selector)) {
				let type: 'table' | 'list' | 'grid' | 'card' = 'card';
				
				if (description.includes('table')) type = 'table';
				else if (description.includes('list')) type = 'list';
				else if (description.includes('grid') || description.includes('row')) type = 'grid';
				
				// Only add if it's clearly a collection container
				if (description.includes('list of') || 
					description.includes('collection') ||
					description.includes('multiple') ||
					description.includes('items') ||
					description.includes('emails') ||
					description.includes('products') ||
					description.includes('users') ||
					description.includes('posts') ||
					description.includes('articles')) {
					
					seenSelectors.add(element.selector);
					tabularData.push({
						selector: element.selector,
						type: type,
						textContent: element.description,
						elementCount: 1
					});
				}
			}
		});
		
		console.info(`Found ${tabularData.length} unique data collection containers:`);
		tabularData.forEach((data, index) => {
			console.info(`  ${index + 1}. ${data.type} container - ${data.selector}`);
			console.info(`     Description: ${data.textContent}`);
		});
		
	} catch (error) {
		console.error('Error extracting tabular data:', error);
	}
	
	return tabularData;
}

async function main() {
	// Initialize Stagehand
	const stagehand = new Stagehand({
		env: config.environment as "LOCAL" | "BROWSERBASE", // Environment to run in: LOCAL or BROWSERBASE
		verbose: 2
	});

	// Initialize the stagehand instance
	await stagehand.init();
	const page = stagehand.page;

	// Log session recording in the terminal (only for Browserbase)
	if (config.environment === "BROWSERBASE" && stagehand.browserbaseSessionID) {
		console.log(
			boxen(
				`View this session recording in your browser: \n${chalk.blue(
					`https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`
				)}`,
				{
					title: "Browserbase",
					padding: 1,
					margin: 3,
				}
			)
		);
	}

	console.info("Launching browser...");
	console.info('Connected!');
	
	// Perform login
	await login(stagehand, config.url, config.username, config.password);
	
	// Initialize path tracking
	const initial_path: PathObject[] = []; // Empty path for the post-login page
	const queue: QueueItem[] = [{
		path: initial_path,
		depth: 0
	}];
	
	let current_path: PathObject[] = [];
	const seen_set = new Set([page_hash(page.url())]); // The initial seen set is just the post-login page
	
	console.info(`Initial page URL: ${page.url()}`);
	console.info(`Initial seen set: ${Array.from(seen_set)}`);
	
	// Main crawling loop
	while (queue.length > 0) {
		const crud_operations: any[] = [];
		const queue_item = queue.pop()!;
		const new_path = queue_item.path;
		const depth = queue_item.depth;
		
		console.info(`Processing queue item at depth ${depth}`);
		
		// Navigate to the specified path
		navigate_to_page(stagehand, current_path, new_path);
		current_path = new_path;
		
		console.info(`Now at path: ${JSON.stringify(current_path)}`);
		
		// Extract tabular data (READ operations)
		console.info('Extracting tabular data for READ operations...');
		const tabularData = await extractTabularData(stagehand);
		
		// Add READ operations for each tabular data element
		tabularData.forEach((data, index) => {
			crud_operations.push({
				operation: 'READ',
				type: data.type,
				selector: data.selector,
				elementCount: data.elementCount,
				hasHeaders: !!data.headers,
				hasRows: !!data.rows,
				textContent: data.textContent.substring(0, 200) + (data.textContent.length > 200 ? '...' : ''),
				path: current_path
			});
		});
		
		console.info(`Found ${crud_operations.length} READ operations`);
		
		// TODO: Extract form elements (CREATE, UPDATE, DELETE operations)
		// TODO: Extract clickables and handle navigation
		
		// For now, just wait a bit to simulate processing
		await page.waitForTimeout(2000);
	}
	
	console.info("Crawling completed!");
	
	// Close the stagehand instance
	await stagehand.close();
}

main().catch(console.error);
