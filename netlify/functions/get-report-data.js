const express = require('express');
const mysql = require('mysql2/promise');

// Database connection (โปรดตรวจสอบว่าถูกต้อง)
const dbConfig = {
  host: 'localhost',
  user: 'your_username',
  password: 'your_password',
  database: 'coupon_system'
};

const getReportData = async (req, res) => {
  try {
    const { startDate, endDate, departmentId } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Query สำหรับ daily_coupons ที่ปรับปรุงใหม่
    // ใช้ coupon_date, เช็ค used_at และ SUM(coupon_value)
    let dailyQuery = `
      SELECT
        coupon_type,
        COUNT(*) AS totalGranted,
        COUNT(dc.used_at) AS totalUsed,
        SUM(CASE WHEN dc.used_at IS NOT NULL THEN dc.coupon_value ELSE 0 END) AS totalAmount
      FROM daily_coupons dc
      LEFT JOIN employees e ON dc.employee_id = e.id
      WHERE dc.coupon_date BETWEEN ? AND ?
    `;
    
    // Query สำหรับ temporary_coupon_requests ที่ปรับปรุงใหม่
    // ใช้ request_date, เช็ค used_at และ SUM(coupon_value)
    let tempQuery = `
      SELECT
        coupon_type,
        COUNT(*) AS totalGranted,
        COUNT(tr.used_at) AS totalUsed,
        SUM(CASE WHEN tr.used_at IS NOT NULL THEN tr.coupon_value ELSE 0 END) AS totalAmount
      FROM temporary_coupon_requests tr
      LEFT JOIN employees e ON tr.employee_id = e.id
      WHERE tr.request_date BETWEEN ? AND ?
      -- หมายเหตุ: กรองสถานะของ temporary coupon ที่ถือว่าเป็น 'สิทธิ์ที่แจกไปแล้ว'
      -- จาก schema ค่า default คือ 'ISSUED' ดังนั้นจึงใช้สถานะนี้เป็นหลัก
      AND tr.status IN ('ISSUED', 'APPROVED', 'USED')
    `;

    let queryParams = [startDate, endDate];
    
    // เพิ่มเงื่อนไขแผนกถ้ามีการเลือก
    if (departmentId && departmentId !== 'all') {
      dailyQuery += ` AND e.department_id = ?`;
      tempQuery += ` AND e.department_id = ?`;
      queryParams.push(departmentId);
    }

    dailyQuery += ` GROUP BY coupon_type`;
    tempQuery += ` GROUP BY coupon_type`;

    // Execute queries
    const [dailyResults] = await connection.execute(dailyQuery, queryParams);
    const [tempResults] = await connection.execute(tempQuery, queryParams);

    await connection.end();

    // รวมผลลัพธ์จากทั้งสอง Query
    const combinedData = {};

    [...dailyResults, ...tempResults].forEach(row => {
        const type = row.coupon_type.toLowerCase(); // 'normal' หรือ 'ot'
        if (!combinedData[type]) {
            combinedData[type] = { totalGranted: 0, totalUsed: 0, totalUsedAmount: 0 };
        }
        combinedData[type].totalGranted += Number(row.totalGranted);
        combinedData[type].totalUsed += Number(row.totalUsed);
        combinedData[type].totalUsedAmount += Number(row.totalAmount);
    });
    
    // จัดรูปแบบข้อมูลให้ตรงกับที่ Frontend ต้องการ
    const finalResponse = {
        normalData: combinedData.normal || { totalGranted: 0, totalUsed: 0, totalUsedAmount: 0 },
        otData: combinedData.ot || { totalGranted: 0, totalUsed: 0, totalUsedAmount: 0 }
    };

    res.json(finalResponse);

  } catch (error) {
    console.error('Error fetching report data:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

module.exports = { getReportData };