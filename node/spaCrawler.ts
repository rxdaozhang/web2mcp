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

interface FormInput {
	selector: string;
	type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'date' | 'datetime-local' | 'time' | 'month' | 'week' | 'color' | 'range' | 'hidden' | 'submit' | 'button' | 'reset' | 'image';
	name?: string;
	id?: string;
	placeholder?: string;
	label?: string;
	required?: boolean;
	value?: string;
	options?: string[]; // For select elements
	description: string;
}

interface FormData {
	selector: string;
	type: 'form' | 'search' | 'login' | 'registration' | 'contact' | 'settings' | 'checkout' | 'feedback' | 'newsletter' | 'filter' | 'delete' | 'remove' | 'unsubscribe' | 'other';
	inputs: FormInput[];
	textContent: string;
	elementCount: number;
	hasSubmitButton: boolean;
	submitButtonText?: string;
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

async function extractFormData(stagehand: Stagehand): Promise<FormData[]> {
	// TODO: Consider replacing form type interpretation with LLM
	const formData: FormData[] = [];
	const seenSelectors = new Set<string>();
	
	try {
		// Find form elements and form-like containers
		const forms = await stagehand.page.observe({
			instruction: "Find all form elements and form-like containers that contain input fields, textareas, select dropdowns, checkboxes, radio buttons, or submit buttons. Look for both actual <form> elements and div containers that function as forms."
		});
		
		for (const form of forms) {
			const description = form.description.toLowerCase();
			
			// Skip if already captured
			if (seenSelectors.has(form.selector)) continue;
			
			// Determine form type based on description and context
			let formType: FormData['type'] = 'other';
			if (description.includes('login') || description.includes('sign in') || description.includes('signin')) {
				formType = 'login';
			} else if (description.includes('register') || description.includes('sign up') || description.includes('signup')) {
				formType = 'registration';
			} else if (description.includes('search') || description.includes('find')) {
				formType = 'search';
			} else if (description.includes('contact') || description.includes('message') || description.includes('support')) {
				formType = 'contact';
			} else if (description.includes('settings') || description.includes('preferences') || description.includes('profile')) {
				formType = 'settings';
			} else if (description.includes('checkout') || description.includes('payment') || description.includes('order')) {
				formType = 'checkout';
			} else if (description.includes('feedback') || description.includes('review') || description.includes('rating')) {
				formType = 'feedback';
			} else if (description.includes('newsletter') || description.includes('subscribe')) {
				formType = 'newsletter';
			} else if (description.includes('filter') || description.includes('sort') || description.includes('refine')) {
				formType = 'filter';
			} else if (description.includes('delete') || description.includes('remove') || description.includes('trash')) {
				formType = 'delete';
			} else if (description.includes('unsubscribe') || description.includes('cancel subscription')) {
				formType = 'unsubscribe';
			}
			
			// Extract inputs within this form
			const inputs: FormInput[] = [];
			
			// Look for input elements within this form
			const formInputs = await stagehand.page.observe({
				instruction: `Find all input elements, textareas, select dropdowns, checkboxes, radio buttons, and buttons within the element at selector "${form.selector}". Focus on elements that users can interact with to provide data.`
			});
			
			for (const input of formInputs) {
				const inputDesc = input.description.toLowerCase();
				const selector = input.selector;
				
				// Determine input type
				let inputType: FormInput['type'] = 'text';
				if (inputDesc.includes('email') || selector.includes('email')) {
					inputType = 'email';
				} else if (inputDesc.includes('password') || selector.includes('password')) {
					inputType = 'password';
				} else if (inputDesc.includes('number') || selector.includes('number')) {
					inputType = 'number';
				} else if (inputDesc.includes('phone') || selector.includes('tel') || selector.includes('phone')) {
					inputType = 'tel';
				} else if (inputDesc.includes('url') || selector.includes('url')) {
					inputType = 'url';
				} else if (inputDesc.includes('search') || selector.includes('search')) {
					inputType = 'search';
				} else if (inputDesc.includes('textarea') || selector.includes('textarea')) {
					inputType = 'textarea';
				} else if (inputDesc.includes('select') || selector.includes('select') || inputDesc.includes('dropdown')) {
					inputType = 'select';
				} else if (inputDesc.includes('checkbox')) {
					inputType = 'checkbox';
				} else if (inputDesc.includes('radio')) {
					inputType = 'radio';
				} else if (inputDesc.includes('file') || selector.includes('file')) {
					inputType = 'file';
				} else if (inputDesc.includes('date') || selector.includes('date')) {
					inputType = 'date';
				} else if (inputDesc.includes('time') || selector.includes('time')) {
					inputType = 'time';
				} else if (inputDesc.includes('submit') || inputDesc.includes('button') || selector.includes('submit') || selector.includes('button')) {
					inputType = 'submit';
				} else if (inputDesc.includes('hidden')) {
					inputType = 'hidden';
				}
				
				// Extract additional input properties
				const isRequired = inputDesc.includes('required') || inputDesc.includes('mandatory');
				const hasPlaceholder = inputDesc.includes('placeholder') || inputDesc.includes('hint');
				const hasLabel = inputDesc.includes('label') || inputDesc.includes('title');
				
				// For select elements, try to extract options
				let options: string[] = [];
				if (inputType === 'select') {
					// This would require additional observation to get the actual options
					// For now, we'll note that it's a select element
					options = [];
				}
				
				inputs.push({
					selector: input.selector,
					type: inputType,
					description: input.description,
					required: isRequired,
					placeholder: hasPlaceholder ? 'Has placeholder' : undefined,
					label: hasLabel ? 'Has label' : undefined,
					options: options.length > 0 ? options : undefined
				});
			}
			
			// Check if form has a submit button
			const hasSubmitButton = inputs.some(input => input.type === 'submit');
			const submitButton = inputs.find(input => input.type === 'submit');
			
			// Only add forms that have inputs
			if (inputs.length > 0) {
				seenSelectors.add(form.selector);
				formData.push({
					selector: form.selector,
					type: formType,
					inputs: inputs,
					textContent: form.description,
					elementCount: inputs.length,
					hasSubmitButton: hasSubmitButton,
					submitButtonText: submitButton?.description
				});
			}
		}
		
		// Also look for standalone input groups that might not be in traditional forms
		const inputGroups = await stagehand.page.observe({
			instruction: "Find groups of input elements that work together as a form-like interface, even if they're not wrapped in a <form> tag. Look for search bars, filter panels, or other input collections."
		});
		
		for (const group of inputGroups) {
			const description = group.description.toLowerCase();
			
			// Skip if already captured or if it's likely part of a form we already found
			if (seenSelectors.has(group.selector)) continue;
			
			// Only consider groups that contain multiple inputs or are clearly form-like
			if (description.includes('input') || 
				description.includes('search') || 
				description.includes('filter') ||
				description.includes('form')) {
				
				// Extract inputs from this group (similar logic as above)
				const groupInputs: FormInput[] = [];
				const groupInputElements = await stagehand.page.observe({
					instruction: `Find all input elements within the element at selector "${group.selector}".`
				});
				
				for (const input of groupInputElements) {
					const inputDesc = input.description.toLowerCase();
					const selector = input.selector;
					
					let inputType: FormInput['type'] = 'text';
					if (inputDesc.includes('search')) inputType = 'search';
					else if (inputDesc.includes('email')) inputType = 'email';
					else if (inputDesc.includes('password')) inputType = 'password';
					else if (inputDesc.includes('submit') || inputDesc.includes('button')) inputType = 'submit';
					
					groupInputs.push({
						selector: input.selector,
						type: inputType,
						description: input.description,
						required: inputDesc.includes('required')
					});
				}
				
				if (groupInputs.length > 0) {
					seenSelectors.add(group.selector);
					
					let groupType: FormData['type'] = 'other';
					if (description.includes('search')) groupType = 'search';
					else if (description.includes('filter')) groupType = 'filter';
					
					formData.push({
						selector: group.selector,
						type: groupType,
						inputs: groupInputs,
						textContent: group.description,
						elementCount: groupInputs.length,
						hasSubmitButton: groupInputs.some(input => input.type === 'submit'),
						submitButtonText: groupInputs.find(input => input.type === 'submit')?.description
					});
				}
			}
		}
		
		console.info(`Found ${formData.length} unique form containers:`);
		formData.forEach((form, index) => {
			console.info(`  ${index + 1}. ${form.type} form - ${form.selector}`);
			console.info(`     Description: ${form.textContent}`);
			console.info(`     Inputs: ${form.inputs.length} (${form.inputs.map(i => i.type).join(', ')})`);
			console.info(`     Has submit button: ${form.hasSubmitButton}`);
		});
		
	} catch (error) {
		console.error('Error extracting form data:', error);
	}
	
	return formData;
}

async function main() {
	// Initialize Stagehand
	const stagehand = new Stagehand({
		env: config.environment as "LOCAL" | "BROWSERBASE", // Environment to run in: LOCAL or BROWSERBASE
		// verbose: 2
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
		console.info('Extracting tabular data...');
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
		
		// Extract form data (CREATE, UPDATE operations)
		console.info('Extracting form data...');
		const formData = await extractFormData(stagehand);
		
		// Add CRUD operations for each form
		formData.forEach((form, index) => {
			// Determine operation type based on form type
			let operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' = 'CREATE';
			if (form.type === 'settings') {
				operation = 'UPDATE';
			} else if (form.type === 'search' || form.type === 'filter') {
				operation = 'READ';
			} else if (form.type === 'delete' || form.type === 'remove' || form.type === 'unsubscribe') {
				operation = 'DELETE';
			}
			
			crud_operations.push({
				operation: operation,
				type: form.type,
				selector: form.selector,
				elementCount: form.elementCount,
				hasSubmitButton: form.hasSubmitButton,
				submitButtonText: form.submitButtonText,
				inputs: form.inputs.map(input => ({
					type: input.type,
					required: input.required,
					placeholder: input.placeholder,
					label: input.label,
					options: input.options
				})),
				textContent: form.textContent.substring(0, 200) + (form.textContent.length > 200 ? '...' : ''),
				path: current_path
			});
		});
		
		console.info(`Found ${formData.length} form operations`);
		
		console.info('=== CRUD OPERATIONS JSON ===');
		console.info(JSON.stringify(crud_operations, null, 2));
		
		// TODO: Extract clickables and handle navigation
		
	}
	
	console.info("Crawling completed!");
	
	// Close the stagehand instance
	await stagehand.close();
}

main().catch(console.error);
