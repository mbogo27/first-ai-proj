import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.2.1";
import pdfToText from "npm:pdf-parse@1.1.1";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' // Allow POST and OPTIONS
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Load environment variables from .env file
    const env = await load();
    const GEMINI_API_KEY = env["GEMINI_API_KEY"] || Deno.env.get("GEMINI_API_KEY");

    if (!GEMINI_API_KEY) {
      console.error(`❌ [DEBUG] GEMINI_API_KEY is not set! Please check your .env file or environment variables.`);
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY environment variable not set"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Method not allowed"
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const formData = await req.formData();
    // *** CHANGE: Use formData.getAll('file') to get all files ***
    const pdfFiles = formData.getAll("file");

    if (!pdfFiles || pdfFiles.length === 0) {
      return new Response(JSON.stringify({
        error: "No PDF files provided"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const allParsedResumes = [];

    // *** NEW: Loop through each uploaded file ***
    for (const pdfFileEntry of pdfFiles) {
      // Ensure it's actually a File object before processing
      if (!(pdfFileEntry instanceof File)) {
        console.warn("Skipping non-file entry in multipart form data.");
        continue;
      }

      const pdfFile = pdfFileEntry as File; // Cast to File for type safety

      // Check if it's a PDF
      if (!pdfFile.type.includes("pdf")) {
        // We can choose to skip non-PDFs or return an error. For multiple, skipping is friendlier.
        console.warn(`Skipping non-PDF file: ${pdfFile.name} (Type: ${pdfFile.type})`);
        allParsedResumes.push({
          fileName: pdfFile.name,
          error: "File is not a PDF and was skipped."
        });
        continue;
      }

      try {
        // Extract text from PDF
        const pdfBuffer = await pdfFile.arrayBuffer();
        const pdfData = new Uint8Array(pdfBuffer);
        const parsedPdf = await pdfToText(pdfData);
        const resumeText = parsedPdf.text;

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash"
        });

        // Prompt for a single resume, as we're processing them one by one
        const prompt = `Extract the following details from the resume and return them in a valid JSON format with these exact field names:
{
  "fileName": "Optional: Original file name (e.g., JohnDoe_Resume.pdf)",
  "name": "Full Name",
  "email": "Email Address",
  "phone": "Phone Number",
  "yearsOfExperience": number,
  "keySkills": ["skill1", "skill2"],
  "educationSummary": "Education details",
  "workHistory": [
    {
      "company": "Company Name",
      "position": "Job Title",
      "duration": "Time period (e.g., 2018 - 2022)",
      "description": "Job description or key responsibilities"
    }
  ]
}

Resume Text: ${resumeText}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();

        let jsonResponse;
        try {
          const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/```\n([\s\S]*?)\n```/) || [
            null,
            responseText
          ];
          const jsonText = jsonMatch[1] || responseText;
          jsonResponse = JSON.parse(jsonText);
          // Add filename to the parsed JSON
          jsonResponse.fileName = pdfFile.name;
        } catch (parseError) {
          console.error(`Failed to parse JSON for ${pdfFile.name}:`, parseError);
          jsonResponse = {
            fileName: pdfFile.name,
            error: "Failed to parse Gemini's response as JSON",
            rawGeminiResponse: responseText // Include raw response for debugging
          };
        }
        allParsedResumes.push(jsonResponse); // Add result to the array
      } catch (fileProcessError) {
        console.error(`Error processing file ${pdfFile.name}:`, fileProcessError);
        allParsedResumes.push({
          fileName: pdfFile.name,
          error: fileProcessError.message || "An error occurred during processing."
        });
      }
    }

    // Return the array of all parsed resumes
    return new Response(JSON.stringify(allParsedResumes), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error("Global error processing request:", error);
    return new Response(JSON.stringify({
      error: error.message || "An unexpected server error occurred."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});