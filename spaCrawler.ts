import crypto from "crypto";
import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import { initializeStagehand, login, navigate_to_page, getConfig, type PathObject } from "./sharedUtils.js";
import { Stagehand } from "@browserbasehq/stagehand";

// Configuration - Environment variables with fallback defaults
const config = {
	...getConfig(),
	maxDepth: parseInt(process.env.SPA_CRAWLER_MAX_DEPTH || "1"),
	openaiApiKey: process.env.OPENAI_API_KEY || "your-openai-key"
};

interface QueueItem {
	path: PathObject[];
	depth: number;
}

interface ClickableElement {
	selector: string;
	type: 'link' | 'button' | 'other';
	text: string;
	href?: string;
	description: string;
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
	operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
}

// Utility functions
function page_hash(url: string): string {
	// Simple hash function for URL - lowercase and hash
	return crypto.createHash('md5').update(url.toLowerCase()).digest('hex');
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

// Helper function to determine CRUD operation based on form type
function determineFormOperation(formType: FormData['type']): 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' {
	switch (formType) {
		case 'search':
		case 'filter':
			return 'READ';
		case 'delete':
		case 'remove':
		case 'unsubscribe':
			return 'DELETE';
		case 'login':
		case 'registration':
		case 'contact':
		case 'feedback':
		case 'newsletter':
		case 'checkout':
			return 'CREATE';
		case 'settings':
			return 'UPDATE';
		default:
			return 'CREATE'; // Default to CREATE for unknown types
	}
}

async function extractFormData(stagehand: Stagehand, existingFormSelectors?: Set<string>): Promise<FormData[]> {
	// TODO: Consider replacing form type interpretation with LLM
	const formData: FormData[] = [];
	const seenSelectors = new Set<string>();
	const usedInputSelectors = new Set<string>(); // Track which input selectors have been used
	
	// If we have existing form selectors, add them to seenSelectors to prevent duplication
	if (existingFormSelectors) {
		existingFormSelectors.forEach(selector => seenSelectors.add(selector));
		console.info(`Excluding ${existingFormSelectors.size} previously extracted form selectors`);
	}
	
	try {
		// Check if a modal is currently open by looking for modal-like elements
		const modalElements = await stagehand.page.observe({
			instruction: "Find any modal, popup, or dialog elements that are currently visible and displayed on the page. Look for elements with modal-like styling (overlays, popups, dialogs) that are not hidden. Only return elements that are actually visible and active on the page."
		});
		
		const isModalOpen = modalElements.length > 0;
		if (isModalOpen) {
			console.info(`Modal detected (${modalElements.length} modal elements) - will focus on modal content and ignore background forms`);
		} else {
			console.info('No modal detected - extracting all forms on the page');
		}
		// Find form elements and form-like containers
		const forms = await stagehand.page.observe({
			instruction: isModalOpen 
				? "Find form elements and form-like containers within the currently open modal or popup. Look for input fields, textareas, select dropdowns, checkboxes, radio buttons, or submit buttons within the modal content. Ignore any forms in the background."
				: "Find all form elements and form-like containers that contain input fields, textareas, select dropdowns, checkboxes, radio buttons, or submit buttons. Look for both actual <form> elements and div containers that function as forms. This includes search boxes."
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
				
				// Skip if this input selector has already been used in another form
				if (usedInputSelectors.has(selector)) {
					console.info(`Skipping input ${selector} - already used in another form`);
					continue;
				}
				
				// Determine input type
				let inputType: FormInput['type'] = 'text';
				if (inputDesc.includes('password') || selector.includes('password')) {
					inputType = 'password';
				} else if (inputDesc.includes('phone') || selector.includes('tel') || selector.includes('phone')) {
					inputType = 'tel';
				} else if (inputDesc.includes('number') || selector.includes('number')) {
					inputType = 'number';
				} else if (inputDesc.includes('url') || selector.includes('url')) {
					inputType = 'url';
				} else if (inputDesc.includes('search') || selector.includes('search')) {
					inputType = 'search';
				} else if (inputDesc.includes('textarea') || selector.includes('textarea')) {
					inputType = 'textarea';
				} else if (inputDesc.includes('select') || selector.includes('select') || inputDesc.includes('dropdown') || inputDesc.includes('menu')) {
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
				
				// Mark this input selector as used
				usedInputSelectors.add(selector);
			}
			
			// Only add forms that have inputs
			if (inputs.length > 0) {
				seenSelectors.add(form.selector);
				formData.push({
					selector: form.selector,
					type: formType,
					inputs: inputs,
					textContent: form.description,
					elementCount: inputs.length,
					operation: determineFormOperation(formType)
				});
			}
		}
		
		// Also look for standalone input groups that might not be in traditional forms
		const inputGroups = await stagehand.page.observe({
			instruction: "Find groups of input elements that work together as a form-like interface, even if they're not wrapped in a <form> tag. Look for search bars, filter panels, dropdown menus, select elements, or other input collections. If there's an input element, then you must have included its parent container in this list."
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
					
					// Skip if this input selector has already been used in another form
					if (usedInputSelectors.has(selector)) {
						console.info(`Skipping input ${selector} - already used in another form`);
						continue;
					}
					
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
					
					// Mark this input selector as used
					usedInputSelectors.add(selector);
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
						operation: determineFormOperation(groupType)
					});
				}
			}
		}
		
		// Also look specifically for search-related elements that might have been missed
		const searchElements = await stagehand.page.observe({
			instruction: "Find any search-related elements on the page. Look for input fields with 'search' in the placeholder text, input fields near search buttons, or any elements that allow users to search or filter content. Include individual search input fields, search forms, and any container that contains search functionality."
		});
		
		for (const searchElement of searchElements) {
			const description = searchElement.description.toLowerCase();
			const selector = searchElement.selector;
			
			// Skip if already captured
			if (seenSelectors.has(selector)) continue;
			
			// Check if it's search-related
			const isSearchRelated = description.includes('search') || 
								   description.includes('find') || 
								   description.includes('filter') ||
								   selector.includes('search') ||
								   description.includes('placeholder') && description.includes('search');
			
			if (isSearchRelated) {
				// Extract inputs from this search element
				const searchInputs: FormInput[] = [];
				const searchInputElements = await stagehand.page.observe({
					instruction: `Find all input elements within the element at selector "${selector}".`
				});
				
				for (const input of searchInputElements) {
					const inputDesc = input.description.toLowerCase();
					const selector = input.selector;
					
					// Skip if this input selector has already been used in another form
					if (usedInputSelectors.has(selector)) {
						console.info(`Skipping input ${selector} - already used in another form`);
						continue;
					}
					
					let inputType: FormInput['type'] = 'search';
					if (inputDesc.includes('submit') || inputDesc.includes('button')) {
						inputType = 'submit';
					}
					
					searchInputs.push({
						selector: input.selector,
						type: inputType,
						description: input.description,
						required: inputDesc.includes('required')
					});
					
					// Mark this input selector as used
					usedInputSelectors.add(selector);
				}
				
				if (searchInputs.length > 0) {
					seenSelectors.add(selector);
					formData.push({
						selector: selector,
						type: 'search',
						inputs: searchInputs,
						textContent: searchElement.description,
						elementCount: searchInputs.length,
						operation: determineFormOperation('search')
					});
				}
			}
		}
		
		console.info(`Found ${formData.length} unique form containers:`);
		formData.forEach((form, index) => {
			console.info(`  ${index + 1}. ${form.type} form - ${form.selector}`);
			console.info(`     Description: ${form.textContent}`);
			console.info(`     Inputs: ${form.inputs.length} (${form.inputs.map(i => i.type).join(', ')})`);
		});
		
	} catch (error) {
		console.error('Error extracting form data:', error);
	}
	
	return formData;
}

async function extractClickableElements(stagehand: Stagehand, formInputSelectors?: Set<string>): Promise<ClickableElement[]> {
	const clickableElements: ClickableElement[] = [];
	const seenSelectors = new Set<string>();
	
	try {
		// Find all clickable elements excluding form elements (inputs, buttons within forms, etc.)
		const clickables = await stagehand.page.observe({
			instruction: "Find all clickable elements on the page including links, buttons, and interactive elements that respond to clicks. Look for elements that might open modals, dropdowns, new pages, or trigger actions. EXCLUDE form elements like input fields, submit buttons, form buttons, and any elements within form containers."
		});
		
		for (const element of clickables) {
			const description = element.description.toLowerCase();
			const selector = element.selector;
			
			// Skip if already captured
			if (seenSelectors.has(selector)) continue;
			
			// Determine basic element type
			let type: ClickableElement['type'] = 'other';
			let href: string | undefined;
			
			// Check for links
			if (selector.includes('a[href') || description.includes('link') || description.includes('href')) {
				type = 'link';
				
				// Extract href if available
				if (description.includes('href=')) {
					const hrefMatch = description.match(/href=["']([^"']+)["']/);
					if (hrefMatch) {
						href = hrefMatch[1];
					}
				}
			}
			// Check for buttons
			else if (selector.includes('button') || description.includes('button')) {
				type = 'button';
			}
			
			// Extract text content
			let text = element.description;
			if (description.includes('text=')) {
				const textMatch = description.match(/text=["']([^"']+)["']/);
				if (textMatch) {
					text = textMatch[1];
				}
			}
			
			// Filter out logout buttons and similar session-ending elements
			const isLogoutElement = description.includes('logout') || 
									description.includes('log out') || 
									description.includes('sign out') || 
									description.includes('signout') ||
									text.toLowerCase().includes('logout') ||
									text.toLowerCase().includes('log out') ||
									text.toLowerCase().includes('sign out') ||
									text.toLowerCase().includes('signout');
			
			// Filter out form input elements that were already captured
			const isFormInputElement = formInputSelectors && formInputSelectors.has(selector);
			
			// Only add elements that are clearly clickable and not logout or form input elements
			if (!isLogoutElement && !isFormInputElement && (type !== 'other' || description.includes('click') || description.includes('button') || description.includes('link'))) {
				seenSelectors.add(selector);
				clickableElements.push({
					selector: selector,
					type: type,
					text: text,
					href: href,
					description: element.description
				});
			} else if (isLogoutElement) {
				console.info(`Skipping logout element: ${text} (${selector})`);
			} else if (isFormInputElement) {
				console.info(`Skipping form input element: ${text} (${selector})`);
			}
		}
		

		
		console.info(`Found ${clickableElements.length} unique clickable elements:`);
		clickableElements.forEach((element, index) => {
			console.info(`  ${index + 1}. ${element.type} - ${element.selector}`);
			console.info(`     Text: ${element.text}`);
		});
		
	} catch (error) {
		console.error('Error extracting clickable elements:', error);
	}
	
	return clickableElements;
}



async function testNavigationAndModals(stagehand: Stagehand, clickableElements: ClickableElement[], existingFormSelectors?: Set<string>): Promise<{navigationElements: ClickableElement[], modalOperations: any[]}> {
	const navigationElements: ClickableElement[] = [];
	const modalOperations: any[] = [];
	
	try {
		// Get current URL to compare against
		const currentUrl = stagehand.page.url();
		console.info(`Testing navigation and modal elements. Current URL: ${currentUrl}`);
		
		// Test all clickable elements to see which ones navigate vs open modals
		const potentialElements = clickableElements;
		
		console.info(`Found ${potentialElements.length} potential elements to test`);
		
		for (const element of potentialElements) {
			console.info(`Testing element: ${element.text} (${element.selector})`);
			
			try {
				// Click on the element
				await stagehand.page.act(`Click on the element with selector "${element.selector}"`);
				await stagehand.page.waitForTimeout(2000); // Wait for potential navigation or modal
				
				// Check if URL changed
				const newUrl = stagehand.page.url();
				
				if (newUrl !== currentUrl) {
					console.info(`✓ Navigation detected: ${currentUrl} → ${newUrl}`);
					navigationElements.push(element);
					
					// Go back to original page for next test
					await navigate_to_page(stagehand, currentUrl, []);
				} else {
					console.info(`✗ No navigation: URL remained ${currentUrl}`);
					
					// Check if a modal opened
					const modalContent = await stagehand.page.observe({
						instruction: "Find any modal, popup, or dialog elements that are currently visible and displayed on the page. Look for elements with modal-like styling (overlays, popups, dialogs) that are not hidden. Only return elements that are actually visible and active on the page."
					});
					
					if (modalContent.length > 0) {
						console.info(`✓ Modal detected: ${modalContent.length} modal elements found`);
						
						// Extract form data from the modal, excluding previously extracted forms
						const modalFormData = await extractFormData(stagehand, existingFormSelectors);
						
						// Add modal operations
						modalOperations.push({
							trigger: {
								selector: element.selector,
								text: element.text,
								type: element.type
							},
							modalContent: modalContent.map(content => ({
								selector: content.selector,
								description: content.description
							})),
							forms: modalFormData,
							operation: 'MODAL_INTERACTION'
						});
						
						// Try to close the modal
						const closeButtons = await stagehand.page.observe({
							instruction: "Find close buttons, X buttons, or cancel buttons in the modal to close it."
						});
						
						if (closeButtons.length > 0) {
							await stagehand.page.act(`Click on the element with selector "${closeButtons[0].selector}"`);
							await stagehand.page.waitForTimeout(1000);
						} else {
							// Try pressing Escape key
							await stagehand.page.keyboard.press('Escape');
							await stagehand.page.waitForTimeout(1000);
						}
					} else {
						console.info(`✗ No modal detected`);
					}
				}
				
			} catch (error) {
				console.error(`Error testing element ${element.selector}:`, error);
				// Continue with next element
			}
		}
		
		console.info(`Found ${navigationElements.length} navigation elements and ${modalOperations.length} modal operations`);
		
	} catch (error) {
		console.error('Error testing navigation and modal elements:', error);
	}
	
	return { navigationElements, modalOperations };
}

async function callChatGPT(crudOperations: any[]): Promise<string> {
	try {
		// Read the PROMPT.txt file
		const promptTemplate = readFileSync('PROMPT.txt', 'utf-8');
		
		// Replace the placeholder with the actual CRUD operations
		const prompt = promptTemplate.replace('{{SUMMARY_OF_PAGE_ACTIONS}}', JSON.stringify(crudOperations, null, 2));
		
		// Initialize OpenAI client
		const openai = new OpenAI({
			apiKey: config.openaiApiKey,
		});
		
		console.info('Calling ChatGPT to generate MCP config...');
		
		// Make the API call
		const completion = await openai.chat.completions.create({
			model: 'gpt-5',
			messages: [
				{
					role: 'user',
					content: prompt
				}
			]
		});
		
		const response = completion.choices[0]?.message?.content;
		if (!response) {
			throw new Error('No response received from ChatGPT');
		}
		
		return response;
	} catch (error) {
		console.error('Error calling ChatGPT:', error);
		throw error;
	}
}

async function main() {
	// Initialize Stagehand using shared utilities
	const { stagehand, page } = await initializeStagehand(config);
	
	// Perform login
	await login(stagehand, config.url, config.username, config.password);
	
	// Initialize path tracking
	const initial_path: PathObject[] = []; // Empty path for the post-login page
	const rootUrl = page.url(); // Store the root URL (post-login page)
	const queue: QueueItem[] = [{
		path: initial_path,
		depth: 0
	}];
	
	let current_path: PathObject[] = initial_path;
	const rootPathHash = page_hash(JSON.stringify(initial_path));
	const seen_set = new Set([rootPathHash]);
	
	console.info(`Root page URL: ${rootUrl}`);
	console.info(`Initial seen set: ${Array.from(seen_set)}`);
	const crud_operations: any[] = [];
	
	// Main crawling loop
	while (queue.length > 0) {
		const { path: new_path, depth } = queue.shift()!;
		
		console.info(`Processing queue item at depth ${depth}`);
		
		// Navigate to the specified path
		await navigate_to_page(stagehand, rootUrl, new_path);
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
			crud_operations.push({
				operation: form.operation,
				type: form.type,
				selector: form.selector,
				elementCount: form.elementCount,
				inputs: form.inputs.map(input => ({
					type: input.type,
					required: input.required,
					placeholder: input.placeholder,
					label: input.label || input.description,
					options: input.options
				})),
				textContent: form.textContent.substring(0, 200) + (form.textContent.length > 200 ? '...' : ''),
				path: current_path
			});
		});
		
		console.info(`Found ${formData.length} form operations`);
		
		// Collect all form input selectors to avoid double-clicking form elements
		const formInputSelectors = new Set<string>();
		formData.forEach(form => {
			form.inputs.forEach(input => {
				if (input.selector) {
					formInputSelectors.add(input.selector);
				}
			});
		});
		
		// Collect all form selectors to prevent duplication in modal extraction
		const existingFormSelectors = new Set<string>();
		formData.forEach(form => {
			existingFormSelectors.add(form.selector);
		});
		
		// Extract clickable elements (for navigation and interaction)
		console.info('Extracting clickable elements...');
		const clickableElements = await extractClickableElements(stagehand, formInputSelectors);
		
		console.info(`Found ${clickableElements.length} clickable elements`);
		
		// Test clickable elements to see which ones navigate vs open modals
		const { navigationElements, modalOperations } = await testNavigationAndModals(stagehand, clickableElements, existingFormSelectors);
		
		// Convert modal operations to CRUD format
		modalOperations.forEach(modalOp => {
			// For each form found in the modal, create a CRUD operation
			modalOp.forms.forEach((form: FormData) => {
				// Create path that includes the modal trigger
				const modalPath = [...current_path, {
					intra_page_path: modalOp.trigger.selector,
					is_new_link: false // Modal triggers don't navigate to new pages
				}];
				
				crud_operations.push({
					operation: form.operation,
					type: form.type,
					selector: form.selector,
					elementCount: form.elementCount,
					inputs: form.inputs.map(input => ({
						type: input.type,
						required: input.required,
						placeholder: input.placeholder,
						label: input.label || input.description,
						options: input.options
					})),
					textContent: form.textContent.substring(0, 200) + (form.textContent.length > 200 ? '...' : ''),
					path: modalPath
				});
			});
		});

		// Add navigation elements to queue
		if (depth < config.maxDepth) {
			// Add new paths to the queue
			for (const element of navigationElements) {
				const newPath: PathObject[] = [...current_path, {
					intra_page_path: element.selector,
					is_new_link: true
				}];
				
				// Create a hash for the new path to avoid duplicates
				const pathHash = page_hash(JSON.stringify(newPath));
				
				if (!seen_set.has(pathHash)) {
					seen_set.add(pathHash);
					queue.unshift({
						path: newPath,
						depth: depth + 1
					});
					console.info(`Added new path to queue: ${element.text} (${element.selector})`);
				}
			}
		}
	}
	console.info("Crawling completed!");
	
	// Save CRUD operations to outputSummaryPageActions.json
	writeFileSync('outputSummaryPageActions.json', JSON.stringify(crud_operations, null, 2));
	console.info('CRUD operations saved to outputSummaryPageActions.json');
	
	console.info('=== CRUD OPERATIONS JSON ===');
	console.info(JSON.stringify(crud_operations, null, 2));
	
	// Call ChatGPT to generate MCP config
	try {
		console.info('Generating MCP config with ChatGPT...');
		const mcpConfig = await callChatGPT(crud_operations);
		
		// Save the response to outputMcpConfig.json
		writeFileSync('outputMcpConfig.json', mcpConfig);
		console.info('MCP config saved to outputMcpConfig.json');
		
		// Print the response to screen
		console.info('=== GENERATED MCP CONFIG ===');
		console.info(mcpConfig);
		
	} catch (error) {
		console.error('Failed to generate MCP config:', error);
	}
	
	// Close the stagehand instance
	await stagehand.close();
}

main().catch(console.error);
