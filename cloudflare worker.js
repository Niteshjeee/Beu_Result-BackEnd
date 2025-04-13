addEventListener("fetch", event => { 
    const request = event.request;

    if (request.method === "OPTIONS") {
        event.respondWith(handleOptions());
    } else {
        event.respondWith(handleRequest(request));
    }
});

function handleOptions() {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400"
        }
    });
}

async function handleRequest(request) {
    const url = new URL(request.url);
    const params = url.searchParams;

    const sem = params.get('sem');
    const year = params.get('year');
    const regNo = params.get('reg_no');

    if (!sem || !year || !regNo) {
        return new Response("Please provide all required parameters: sem, year, and reg_no", { 
            status: 400, 
            headers: corsHeaders() 
        });
    }

    if (!regNo || regNo.length < 11) {
        return new Response("Please provide a valid registration number.", { 
            status: 400, 
            headers: corsHeaders() 
        });
    }

    const firstTwoDigits = parseInt(regNo.slice(0, 2));
    const restReg = regNo.slice(2, -3);
    const lastThreeDigits = parseInt(regNo.slice(-3));
    const regBase = regNo.slice(0, -3);

    const startRegNo = 1;
    const endRegNo = 60;
    const batchSize = 5;

    async function fetchBatch(start, base) {
        const batchRegNo = `${base}${String(start).padStart(3, "0")}`;
        const vercelUrl = `https://${sem}-semester.vercel.app/result?year=${year}&reg_no=${batchRegNo}`;

        try {
            const response = await fetch(vercelUrl);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch data for batch starting with reg_no: ${batchRegNo}. Error: ${errorText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching batch ${batchRegNo}:`, error);
            return { error: error.message };
        }
    }

    const fetchPromises = [];
    const isLE = lastThreeDigits >= 901 && lastThreeDigits <= 925;
    const isRegular = lastThreeDigits >= 1 && lastThreeDigits <= 60;

    if (isRegular) {
        // Regular Students
        for (let i = startRegNo; i <= endRegNo; i += batchSize) {
            fetchPromises.push(fetchBatch(i, regBase));
        }

        // Also fetch LE
        const leRegBase = `${firstTwoDigits + 1}${restReg}`;
        for (let i = 901; i <= 925; i += batchSize) {
            fetchPromises.push(fetchBatch(i, leRegBase));
        }
    } else if (isLE) {
        // LE Students
        for (let i = 901; i <= 925; i += batchSize) {
            fetchPromises.push(fetchBatch(i, regBase));
        }

        // Also fetch Regular
        const regularRegBase = `${firstTwoDigits - 1}${restReg}`;
        for (let i = 1; i <= 60; i += batchSize) {
            fetchPromises.push(fetchBatch(i, regularRegBase));
        }
    } else {
        return new Response("Invalid last 3 digits of registration number.", {
            status: 400,
            headers: corsHeaders()
        });
    }

    try {
        const allResults = await Promise.all(fetchPromises);
        const finalResults = allResults.flat();
        return new Response(JSON.stringify(finalResults), {
            headers: { 
                "Content-Type": "application/json",
                ...corsHeaders()
            }
        });
    } catch (error) {
        console.error("An error occurred while fetching student data:", error);
        return new Response(JSON.stringify({ error: "An error occurred while fetching student data." }), {
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                ...corsHeaders()
            }
        });
    }
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

// Example: https://api.beunotes.workers.dev/result?sem=1st&year=2023&reg_no=22104134010
