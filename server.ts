import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.2.1";
import pdfToText from "npm:pdf-parse@1.1.1";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET' // Added GET for serving HTML
};

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // --- NEW: Serve index.html for GET requests to the root path ---
  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const htmlContent = await Deno.readTextFile("./index.html");
      return new Response(htmlContent, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders // Include CORS headers for the HTML as well
        }
      });
    } catch (error) {
      console.error("Error serving index.html:", error);
      return new Response("Internal Server Error: Could not load index.html", {
        status: 500,
        headers: corsHeaders
      });
    }
  }

  // --- EXISTING: Handle POST requests for PDF parsing ---
  if (req.method === 'POST' && url.pathname === '/') { // Assuming / as the API endpoint
    try {
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

      const formData = await req.formData();
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

      for (const pdfFileEntry of pdfFiles) {
        if (!(pdfFileEntry instanceof File)) {
          console.warn("Skipping non-file entry in multipart form data.");
          continue;
        }

        const pdfFile = pdfFileEntry as File;

        if (!pdfFile.type.includes("pdf")) {
          console.warn(`Skipping non-PDF file: ${pdfFile.name} (Type: ${pdfFile.type})`);
          allParsedResumes.push({
            fileName: pdfFile.name,
            error: "File is not a PDF and was skipped."
          });
          continue;
        }

        try {
          const pdfBuffer = await pdfFile.arrayBuffer();
          const pdfData = new Uint8Array(pdfBuffer);
          const parsedPdf = await pdfToText(pdfData);
          const resumeText = parsedPdf.text;

          const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
          const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash"
          });

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
            jsonResponse.fileName = pdfFile.name;
          } catch (parseError) {
            console.error(`Failed to parse JSON for ${pdfFile.name}:`, parseError);
            jsonResponse = {
              fileName: pdfFile.name,
              error: "Failed to parse Gemini's response as JSON",
              rawGeminiResponse: responseText
            };
          }
          allParsedResumes.push(jsonResponse);
        } catch (fileProcessError) {
          console.error(`Error processing file ${pdfFile.name}:`, fileProcessError);
          allParsedResumes.push({
            fileName: pdfFile.name,
            error: fileProcessError.message || "An error occurred during processing."
          });
        }
      }

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
  }

  // Handle other unknown requests
  return new Response("Not Found", { status: 404, headers: corsHeaders });
});