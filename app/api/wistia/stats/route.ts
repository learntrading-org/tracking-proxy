import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('mediaId');
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');

    if (!mediaId) {
      return NextResponse.json({ error: 'mediaId is required' }, { status: 400 });
    }

    // Build the URL for Wistia API
    const wistiaUrl = new URL(`https://api.wistia.com/modern/stats/medias/${mediaId}/by_date`);
    if (start_date) wistiaUrl.searchParams.append('start_date', start_date);
    if (end_date) wistiaUrl.searchParams.append('end_date', end_date);

    const token = process.env.WISTIA_API_TOKEN;
    if (!token) {
       return NextResponse.json({ error: 'Wistia API token not configured' }, { status: 500 });
    }

    const response = await fetch(wistiaUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        // Optional: 'X-Wistia-API-Version': '2026-03' if required, but default often works.
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Wistia API Error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch Wistia stats', details: errorText }, 
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Internal Server Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
