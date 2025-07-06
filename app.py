import os
import json
import io
import pdfplumber
import google.generativeai as genai
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY environment variable not set.")
    # In a production app, you might raise an error or exit here.
    # For now, we'll proceed but API calls will fail.
else:
    genai.configure(api_key=GEMINI_API_KEY)
    print("Gemini API configured successfully.")

# Define the model to use
GEMINI_MODEL = "gemini-1.5-flash"

# --- Route to serve the frontend HTML file ---
@app.route('/')
def serve_index():
    """Serves the index.html file for the frontend."""
    # This assumes index.html is in the same directory as app.py
    return send_from_directory('.', 'index.html')

# --- Route to handle PDF parsing requests ---
@app.route('/parse', methods=['POST'])
def parse_pdfs():
    """
    Handles POST requests to parse PDF files.
    Expects multiple files under the 'file' key in FormData.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400

    uploaded_files = request.files.getlist('file')
    if not uploaded_files:
        return jsonify({"error": "No selected files"}), 400

    all_parsed_resumes = []

    for uploaded_file in uploaded_files:
        file_name = uploaded_file.filename
        # Check if the file is a PDF
        if not file_name.lower().endswith('.pdf'):
            all_parsed_resumes.append({
                "fileName": file_name,
                "error": "File is not a PDF and was skipped."
            })
            continue # Skip to the next file

        try:
            # Read PDF content from the in-memory file object
            # pdfplumber expects a file-like object or path
            with pdfplumber.open(io.BytesIO(uploaded_file.read())) as pdf:
                resume_text = ""
                for page in pdf.pages:
                    resume_text += page.extract_text() + "\n"

            if not resume_text.strip():
                all_parsed_resumes.append({
                    "fileName": file_name,
                    "error": "Could not extract text from PDF. It might be an image-only PDF or empty."
                })
                continue

            # Initialize Gemini model
            model = genai.GenerativeModel(GEMINI_MODEL)

            # Create the prompt for Gemini
            prompt = f"""Extract the following details from the resume and return them in a valid JSON format with these exact field names:
{{
  "fileName": "Optional: Original file name (e.g., JohnDoe_Resume.pdf)",
  "name": "Full Name",
  "email": "Email Address",
  "phone": "Phone Number",
  "yearsOfExperience": number,
  "keySkills": ["skill1", "skill2"],
  "educationSummary": "Education details",
  "workHistory": [
    {{
      "company": "Company Name",
      "position": "Job Title",
      "duration": "Time period (e.g., 2018 - 2022)",
      "description": "Job description or key responsibilities"
    }}
  ]
}}

Resume Text: {resume_text}"""

            # Generate content with Gemini
            response = model.generate_content(prompt)
            response_text = response.text

            # Try to parse the response as JSON
            json_response = {}
            try:
                # Attempt to extract JSON from markdown code blocks
                json_match = None
                if '```json' in response_text:
                    json_match = response_text.split('```json', 1)[1].split('```', 1)[0]
                elif '```' in response_text: # Fallback for generic code blocks
                    json_match = response_text.split('```', 1)[1].split('```', 1)[0]

                if json_match:
                    json_response = json.loads(json_match.strip())
                else:
                    json_response = json.loads(response_text.strip()) # Try parsing directly

                json_response["fileName"] = file_name # Add filename to the parsed JSON

            except json.JSONDecodeError as e:
                print(f"Failed to parse JSON for {file_name}: {e}")
                json_response = {
                    "fileName": file_name,
                    "error": "Failed to parse Gemini's response as JSON",
                    "rawGeminiResponse": response_text
                }
            except Exception as e:
                print(f"An unexpected error occurred during JSON parsing for {file_name}: {e}")
                json_response = {
                    "fileName": file_name,
                    "error": f"An unexpected error occurred during JSON parsing: {str(e)}",
                    "rawGeminiResponse": response_text
                }

            all_parsed_resumes.append(json_response)

        except Exception as e:
            print(f"Error processing file {file_name}: {e}")
            all_parsed_resumes.append({
                "fileName": file_name,
                "error": str(e) or "An error occurred during processing."
            })

    return jsonify(all_parsed_resumes), 200

if __name__ == '__main__':
    # Run the Flask app on all available interfaces (0.0.0.0) and port 8000
    # This is important for deployment to services like Koyeb
    app.run(host='0.0.0.0', port=8000, debug=True)
