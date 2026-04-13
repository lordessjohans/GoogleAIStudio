import { GoogleGenAI, GenerateContentResponse, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface IndividualDetails {
  firstName: string;
  lastName: string;
  middleName?: string;
  dob?: string;
}

export async function searchCaseInfo(query: string, caseType?: string, jurisdiction?: string, individualDetails?: IndividualDetails) {
  const searchSubject = individualDetails 
    ? `${individualDetails.firstName} ${individualDetails.middleName ? individualDetails.middleName + ' ' : ''}${individualDetails.lastName}${individualDetails.dob ? ' (DOB: ' + individualDetails.dob + ')' : ''}`
    : query;

  console.log(`Searching for case: ${searchSubject} (Type: ${caseType || 'Any'}, Jurisdiction: ${jurisdiction || 'Any'})`);
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for ${caseType ? `${caseType} ` : ""}court case information or legal records related to: ${searchSubject}${jurisdiction ? ` in ${jurisdiction}` : ""}. 
      You MUST use Google Search to find real, specific case records, docket information, court filings, or public records for individuals or parties. 
      Focus specifically on finding **CURRENT, PENDING, or ACTIVE** court cases, dockets, and hearings. 
      If searching for an individual, look for active warrants, pending litigation, recent judgments, or any other relevant legal information from official state, county, and federal databases (e.g., PACER, state court portals, county clerk websites).
      Also search for any other publicly available personal information from online sources that might be relevant to their legal standing or public record.
      
      Provide:
      1. A detailed summary of any **CURRENT or PENDING** case(s) found, including case numbers, filing dates, and current status.
      2. **Case Outcome Probability:** An estimated percentage of success/winning based on historical data from similar cases in open research datasets. Include a brief explanation of the factors influencing this score.
      3. A guided list of actions and available options for the user.
      4. **Court Filing Agency:** Identify the specific court or agency where this case is filed. Provide a direct link to their official filing portal or website.
      5. **Public Record Resources:** List specific online resources, open datasets (e.g., Data.gov, CourtListener, PACER), or public access APIs that are helpful for obtaining case-specific details for this jurisdiction.
      6. **CRITICAL: Direct, actionable links to the state-specific e-filing (e-file) portal for this jurisdiction.**
      7. Direct links to the official court website for further clarification.
      
      If no current or pending cases are found, explicitly state that no active records were located in the searched databases and suggest where the user might look manually.
      
      Ensure all links are accurate and lead directly to the filing or information pages.`,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction: "You are Action Jaxson, a specialized legal guide AI. Your goal is to help users navigate court cases. You MUST use Google Search to find REAL, CURRENT, and PENDING case data. Prioritize finding active dockets and hearings. Provide statistical outcome probabilities based on historical data, but always include a heavy disclaimer that these are estimates and not legal advice. Suggest the user consult with a licensed legal professional for personalized advice. Prioritize accurate e-filing links.",
      },
    });

    let text = response.text || "";
    
    // Extract grounding sources if available
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks && groundingChunks.length > 0) {
      text += "\n\n### Sources & References\n";
      groundingChunks.forEach((chunk: any) => {
        if (chunk.web?.uri) {
          text += `- [${chunk.web.title || chunk.web.uri}](${chunk.web.uri})\n`;
        }
      });
    }

    return text;
  } catch (error) {
    console.error("Error searching case info:", error);
    throw error;
  }
}

export async function analyzeCaseDocument(data: string, mimeType: string, isBase64: boolean = true) {
  try {
    const contentPart = isBase64 
      ? { inlineData: { data: data, mimeType: mimeType } }
      : { text: `DOCUMENT CONTENT:\n${data}` };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        contentPart,
        {
          text: `Analyze this court document. Identify the case number, parties, key dates, and status. 
          Provide:
          1. **Case Outcome Probability:** An estimated percentage of success/winning based on historical data from similar cases in open research datasets. Include a brief explanation of the factors influencing this score.
          2. A guided list of actions and available options for the user.
          3. A procedural checklist for following up.
          4. **Court Filing Agency:** Identify the specific court or agency where this case is filed. Provide a direct link to their official filing portal or website.
          5. **Public Record Resources:** List specific online resources, open datasets (e.g., Data.gov, CourtListener, PACER), or public access APIs that are helpful for obtaining case-specific details for this jurisdiction.
          6. **CRITICAL: Direct, actionable links to the state-specific e-filing (e-file) portal for this jurisdiction.**
          7. Direct links to the official court website for further clarification.
          
          Ensure all links are accurate and lead directly to the filing or information pages.`,
        },
      ],
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are Action Jaxson, a specialized legal guide AI. Analyze the document and use Google Search to find historical outcomes for similar cases. Provide a statistical probability score. Suggest the user consult with a licensed legal professional for personalized advice. Disclaimer: You are an AI, not a lawyer. This is not legal advice.",
      },
    });

    let text = response.text || "";
    
    // Extract grounding sources if available
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks && groundingChunks.length > 0) {
      text += "\n\n### Sources & References\n";
      groundingChunks.forEach((chunk: any) => {
        if (chunk.web?.uri) {
          text += `- [${chunk.web.title || chunk.web.uri}](${chunk.web.uri})\n`;
        }
      });
    }

    return text;
  } catch (error) {
    console.error("Error analyzing document:", error);
    throw error;
  }
}

export async function generateReminders(deadlines: { title: string; date: string; description?: string }[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Based on the following court deadlines, provide a brief, actionable reminder or tip for each one to help the user stay prepared. 
      Deadlines: ${JSON.stringify(deadlines)}`,
      config: {
        systemInstruction: "You are Action Jaxson, a specialized legal guide AI. For each deadline provided, give a short (1-2 sentence) actionable tip or reminder. Be encouraging and practical. Disclaimer: You are an AI, not a lawyer. This is not legal advice.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Error generating reminders:", error);
    throw error;
  }
}

export async function chatWithAssistant(message: string, history: { role: string; parts: { text: string }[] }[]) {
  try {
    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: "You are Action Jaxson, a specialized legal guide AI. You help users with questions about court cases, legal procedures, and finding case information. You are professional, helpful, and direct. When asked to find cases, use Google Search to locate official court records, case summaries, and filing information. Provide direct links where possible. Always include a disclaimer that you are an AI and not a lawyer, and this is not legal advice. Encourage consulting a licensed legal professional.",
        tools: [{ googleSearch: {} }],
      },
      history: history,
    });

    const response = await chat.sendMessage({ message });
    let text = response.text || "";

    // Extract grounding sources if available
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks && groundingChunks.length > 0) {
      text += "\n\n### Sources & References\n";
      groundingChunks.forEach((chunk: any) => {
        if (chunk.web?.uri) {
          text += `- [${chunk.web.title || chunk.web.uri}](${chunk.web.uri})\n`;
        }
      });
    }

    return text;
  } catch (error) {
    console.error("Error in AI chat:", error);
    throw error;
  }
}
