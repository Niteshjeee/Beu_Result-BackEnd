const axios = require('axios');
const cheerio = require('cheerio');

// Base URL mapping by year
const BASE_URLS = {
    2022: 'http://results.beup.ac.in/ResultsBTech1stSem2022_B2022Pub.aspx',
    2023: 'http://results.beup.ac.in/ResultsBTech1stSem2023_B2023Pub.aspx',
    2024: 'http://results.beup.ac.in/ResultsBTech1stSem2024_B2024Pub.aspx',
    2025: 'http://results.beup.ac.in/ResultsBTech1stSem2025_B2025Pub.aspx',
    2026: 'http://results.beup.ac.in/ResultsBTech1stSem2026_B2026Pub.aspx',
};

// CORS headers
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// Fetch with retries function
async function fetchWithRetries(url, maxRetries = 3, initialDelay = 1000, backoffFactor = 2.0) {
    let delay = initialDelay;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await axios.get(url);
            if (response.status === 200 && !response.data.includes("No Record Found !!!")) {
                return response.data;
            }
            return null; // No records found
        } catch (error) {
            if (attempt === maxRetries - 1) {
                return { error: error.message }; // Return error message after max retries
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= backoffFactor; // Exponential backoff
        }
    }
}

// Parse student data
function parseStudentData(html, regNo) {
    if (!html) return null;
    const $ = cheerio.load(html);

    const data = {
        university: "Bihar Engineering University, Patna",
        exam_name: $("#ContentPlaceHolder1_DataList4_Exam_Name_0").text().trim() || "N/A",
        registration_no: regNo,
        semester: $("#ContentPlaceHolder1_DataList2_Exam_Name_0").text().trim() || "N/A",
        exam_date: $("#ContentPlaceHolder1_DataList2 td:nth-of-type(2)").text().split(":").pop().trim() || "N/A",
        student_name: $("#ContentPlaceHolder1_DataList1_StudentNameLabel_0").text().trim() || "N/A",
        college_name: $("#ContentPlaceHolder1_DataList1_CollegeNameLabel_0").text().trim() || "N/A",
        course_name: $("#ContentPlaceHolder1_DataList1_CourseLabel_0").text().trim() || "N/A",
    };

    // Extract theory subjects
    data.theory_subjects = [];
    $("#ContentPlaceHolder1_GridView1 tr").slice(1).each((i, el) => {
        const cells = $(el).find("td");
        if (cells.length >= 7) {
            data.theory_subjects.push({
                subject_code: $(cells[0]).text().trim(),
                subject_name: $(cells[1]).text().trim(),
                ese: $(cells[2]).text().trim(),
                ia: $(cells[3]).text().trim(),
                total: $(cells[4]).text().trim(),
                grade: $(cells[5]).text().trim(),
                credit: $(cells[6]).text().trim(),
            });
        }
    });

    // Extract practical subjects
    data.practical_subjects = [];
    $("#ContentPlaceHolder1_GridView2 tr").slice(1).each((i, el) => {
        const cells = $(el).find("td");
        if (cells.length >= 7) {
            data.practical_subjects.push({
                subject_code: $(cells[0]).text().trim(),
                subject_name: $(cells[1]).text().trim(),
                ese: $(cells[2]).text().trim(),
                ia: $(cells[3]).text().trim(),
                total: $(cells[4]).text().trim(),
                grade: $(cells[5]).text().trim(),
                credit: $(cells[6]).text().trim(),
            });
        }
    });

    // SGPA extraction
    data.sgpa = $("#ContentPlaceHolder1_DataList5_GROSSTHEORYTOTALLabel_0").text().trim() || "SGPA not found";

    // Semester grades
    const semesterGrades = {};
    $("#ContentPlaceHolder1_GridView3 tr:nth-child(2) td").each((index, cell) => {
        const semesterKeys = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "Cur. CGPA"];
        semesterGrades[semesterKeys[index]] = $(cell).text().trim() || "NA";
    });

    // Convert semesterGrades into an array and prepend "semester: sgpa"
    data.semester_grades = [{ semester: "sgpa" }, ...Object.entries(semesterGrades).map(([key, value]) => ({ semester: key, sgpa: value }))];

    // Extract failed subjects for remarks
    const failedSubjects = [];

    // Check theory subjects for fails
    data.theory_subjects.forEach(subject => {
        if (subject.grade === "F") { // Assuming 'F' denotes failure
            failedSubjects.push(subject.subject_name);
        }
    });

    // Check practical subjects for fails
    data.practical_subjects.forEach(subject => {
        if (subject.grade === "F") { // Assuming 'F' denotes failure
            failedSubjects.push(subject.subject_name + " (p)"); // Append (p) for practical subjects
        }
    });

    // Generate remarks
    if (failedSubjects.length > 0) {
        data.remarks = `FAIL: ${failedSubjects.join(", ")}`;
    } else {
        data.remarks = "Pass"; // Default remark for passing
    }

    // Publish date extraction
    data.publish_date = $("#ContentPlaceHolder1_DataList3 tr:nth-of-type(2) td").text().split(":").pop().trim() || "";

    return data;
}

// Main API endpoint
module.exports = async (req, res) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        return res.end();
    }

    const { reg_no, year } = req.query;
    const sem = req.query.sem || "I"; // Default to semester I if no sem is provided
    if (!reg_no || !year) {
        return res.status(400).json({ error: "Missing 'reg_no' or 'year' query parameter" });
    }

    // Validate the year
    const baseUrl = BASE_URLS[year];
    if (!baseUrl) {
        return res.status(400).json({ error: `No results available for the year ${year}` });
    }

    const regBase = reg_no.slice(0, -3);
    const startNum = parseInt(reg_no.slice(-3), 10);
    const batchSize = 5;
    const results = [];

    for (let i = startNum; i < startNum + batchSize; i++) {
        const currentRegNo = `${regBase}${String(i).padStart(3, '0')}`;
        const url = `${baseUrl}?Sem=${sem}&RegNo=${currentRegNo}`;
        const pageContent = await fetchWithRetries(url);
        const result = parseStudentData(pageContent, currentRegNo);

        if (result) {
            results.push(result);
            results.push({ separator: "************************************" }); // Add separator here
        }
    }

    res.status(200).json(results);
};
