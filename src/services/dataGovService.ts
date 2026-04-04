
export interface DataGovDataset {
  id: string;
  title: string;
  notes: string;
  organization?: {
    title: string;
  };
  resources: {
    id: string;
    name: string;
    format: string;
    url: string;
    description?: string;
  }[];
  metadata_modified: string;
}

export interface DataGovSearchResponse {
  success: boolean;
  result: {
    count: number;
    results: DataGovDataset[];
  };
}

/**
 * Service to interact with Data.gov CKAN API
 * Documentation: https://docs.ckan.org/en/latest/api/index.html
 */
export const dataGovService = {
  /**
   * Search for datasets on Data.gov
   * @param query The search query (e.g., "court", "legal", "case")
   * @param rows Number of results to return
   */
  searchDatasets: async (query: string, rows: number = 10): Promise<DataGovDataset[]> => {
    try {
      const url = `/api/datagov/search?q=${encodeURIComponent(query)}&rows=${rows}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Data.gov API error: ${response.statusText}`);
      }
      
      const data: DataGovSearchResponse = await response.json();
      
      if (data.success) {
        return data.result.results;
      }
      
      return [];
    } catch (error) {
      console.error("Error searching Data.gov:", error);
      return [];
    }
  },

  /**
   * Get details for a specific dataset
   */
  getDatasetDetails: async (id: string): Promise<DataGovDataset | null> => {
    try {
      const url = `/api/datagov/show?id=${encodeURIComponent(id)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Data.gov API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        return data.result;
      }
      
      return null;
    } catch (error) {
      console.error("Error fetching Data.gov dataset details:", error);
      return null;
    }
  }
};
