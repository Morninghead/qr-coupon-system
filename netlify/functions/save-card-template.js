const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // ตรวจสอบ authorization
    const authHeader = event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No authorization header' })
      };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: user, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // ตรวจสอบสิทธิ์ผู้ใช้
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('role, department')
      .eq('user_id', user.user.id)
      .single();

    if (!userProfile || (userProfile.role !== 'superuser' && userProfile.role !== 'department_admin')) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Insufficient permissions' })
      };
    }

    const requestBody = JSON.parse(event.body || '{}');
    const { name, template_data, description, id } = requestBody;

    console.log('Saving template:', { name, id, elementsCount: template_data?.elements?.length });

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template name is required' })
      };
    }

    if (!template_data || typeof template_data !== 'object') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template data is required and must be an object' })
      };
    }

    // Validate template data structure
    if (!template_data.elements || !Array.isArray(template_data.elements)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template data must contain an elements array' })
      };
    }

    if (template_data.elements.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template must contain at least one element' })
      };
    }

    // Validate each element
    for (let i = 0; i < template_data.elements.length; i++) {
      const element = template_data.elements[i];
      
      if (!element.type || typeof element.type !== 'string') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Element ${i + 1}: type is required` })
        };
      }

      if (typeof element.x !== 'number' || typeof element.y !== 'number') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Element ${i + 1}: x and y coordinates are required` })
        };
      }

      // Type-specific validation
      switch (element.type) {
        case 'Text':
          if (element.text === undefined || element.text === null) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: `Element ${i + 1}: text content is required for Text elements` })
            };
          }
          break;
          
        case 'Rect':
          if (typeof element.width !== 'number' || typeof element.height !== 'number' || 
              element.width <= 0 || element.height <= 0) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: `Element ${i + 1}: valid width and height are required for Rect elements` })
            };
          }
          break;
          
        case 'Image':
          if (!element.src || typeof element.src !== 'string') {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: `Element ${i + 1}: src is required for Image elements` })
            };
          }
          break;
      }
    }

    let result;
    
    if (id) {
      // Update existing template
      console.log('Updating existing template:', id);
      
      const { data, error } = await supabase
        .from('card_templates')
        .update({
          name: name.trim(),
          template_data: template_data,
          description: description?.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Update error:', error);
        throw error;
      }
      result = data;
    } else {
      // Create new template
      console.log('Creating new template');
      
      const { data, error } = await supabase
        .from('card_templates')
        .insert({
          name: name.trim(),
          template_data: template_data,
          description: description?.trim() || null,
          created_by: user.user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }
      result = data;
    }

    console.log('Template saved successfully:', result.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        template: result,
        message: id ? 'Template updated successfully' : 'Template created successfully'
      })
    };

  } catch (error) {
    console.error('Error saving template:', error);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique constraint violation
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template name already exists' })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to save template',
        details: error.message
      })
    };
  }
};
