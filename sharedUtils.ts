import { Stagehand } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import dotenv from "dotenv";

// Load environment variables from .env file in the same directory
dotenv.config({ path: ".env" });

// Types
interface PathObject {
	intra_page_path: string;
	is_new_link: boolean;
}

// Configuration interface
interface StagehandConfig {
	url: string;
	username: string;
	password: string;
	environment: "LOCAL" | "BROWSERBASE";
}

/**
 * Initialize Stagehand with the given configuration
 * @param config Configuration object containing URL, credentials, and environment
 * @returns Initialized Stagehand instance and page
 */
export async function initializeStagehand(config: StagehandConfig, suppressLogs: boolean = false): Promise<{ stagehand: Stagehand; page: any }> {
	// Initialize Stagehand with logging configuration
	const stagehand = new Stagehand({
		env: config.environment, // Environment to run in: LOCAL or BROWSERBASE
		verbose: suppressLogs ? 0 : 1, // 0 = no logs, 1 = minimal logs, 2 = verbose logs
	});

	// Initialize the stagehand instance
	await stagehand.init();
	const page = stagehand.page;

	// Log session recording in the terminal (only for Browserbase)
	if (config.environment === "BROWSERBASE" && stagehand.browserbaseSessionID) {
		console.error(
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

	// Set up file chooser handler to prevent file dialogs from blocking the crawler
	page.on('filechooser', async (fileChooser: any) => {
	console.log('File chooser opened - automatically closing with empty file');
	// Set an empty file array to close the dialog without actually uploading anything
	await fileChooser.setFiles([]);
	});

	return { stagehand, page };
}

/**
 * Perform login to the specified website
 * @param stagehand Initialized Stagehand instance
 * @param url Login URL
 * @param username Username for login
 * @param password Password for login
 */
export async function login(stagehand: Stagehand, url: string, username: string, password: string): Promise<void> {
	// Check if login should be skipped
	const skipLogin = process.env.SKIP_LOGIN === "true";
	if (skipLogin) {
		console.error("Login skipped - SKIP_LOGIN environment variable is set to true");
		// Still navigate to the URL but skip the login process
		await stagehand.page.goto(url);
		await stagehand.page.waitForTimeout(5000);
		await stagehand.page.act('Accept any cookies pop-up on the page');
		return;
	}

	// TODO: More accurate login detection
	// TODO: Bot detection circumvention
	console.error("Starting login process...");
	
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
	
	console.error("Login completed successfully!");
}

/**
 * Navigate to a specific page using the given path
 * @param stagehand Initialized Stagehand instance
 * @param rootUrl Root URL to start navigation from
 * @param new_path Array of path objects defining the navigation steps
 */
export async function navigate_to_page(stagehand: Stagehand, rootUrl: string, new_path: PathObject[]): Promise<void> {
	console.error(`Navigating to path ${JSON.stringify(new_path)}`);
	
	// If new_path is empty, go to the root page
	if (new_path.length === 0) {
		console.error('Target is root page, navigating to root');
		await stagehand.page.goto(rootUrl);
		await stagehand.page.waitForTimeout(2000);
		return;
	}
	
	// Always start from the root page to ensure consistent starting point
	console.error(`Starting from root page: ${rootUrl}`);
	await stagehand.page.goto(rootUrl);
	await stagehand.page.waitForTimeout(2000);
	
	// Navigate through each step in the path
	for (let i = 0; i < new_path.length; i++) {
		const pathStep = new_path[i];
		console.error(`Step ${i + 1}/${new_path.length}: Clicking on element ${pathStep.intra_page_path}`);
		
		try {
			// Click on the element
			await stagehand.page.act(`Click on the element with selector "${pathStep.intra_page_path}"`);
			await stagehand.page.waitForTimeout(2000); // Wait for navigation/loading
			
			// If it's a new link, wait a bit more for the page to load
			if (pathStep.is_new_link) {
				await stagehand.page.waitForTimeout(3000);
			}
			
			console.error(`Successfully navigated to step ${i + 1}, current URL: ${stagehand.page.url()}`);
		} catch (error) {
			console.error(`Failed to click on element ${pathStep.intra_page_path}:`, error);
			throw error; // Fail the navigation if any step fails
		}
	}
	
	console.error(`Navigation completed. Final URL: ${stagehand.page.url()}`);
}

/**
 * Get configuration from environment variables with fallback defaults
 * @returns Configuration object
 */
export function getConfig(): StagehandConfig {
	return {
		url: process.env.SPA_CRAWLER_URL || "https://example.com/login",
		username: process.env.SPA_CRAWLER_USERNAME || "your_username",
		password: process.env.SPA_CRAWLER_PASSWORD || "your_password",
		environment: (process.env.SPA_CRAWLER_ENV || "LOCAL") as "LOCAL" | "BROWSERBASE"
	};
}

// Export types for use in other files
export type { PathObject };
